import logging
import re
import warnings
from datetime import datetime, timedelta, timezone
from io import BytesIO
from uuid import uuid4

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.core.config import AWS_REGION, S3_BUCKET_NAME
from app.models.question import PendingS3Deletion, QuestionUpload

logger = logging.getLogger(__name__)
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
SIGNED_URL_SECONDS = 3600
UPLOAD_URL_SECONDS = 600
STAGING_CLEANUP_GRACE_SECONDS = 3600
IMAGE_FORMATS = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "GIF": ("image/gif", "gif"),
    "WEBP": ("image/webp", "webp"),
}
IMAGE_EXTENSIONS = {mime: extension for mime, extension in IMAGE_FORMATS.values()}
STORAGE_ERRORS = (BotoCoreError, ClientError, OSError)


def utcnow() -> datetime:
    # Store naive UTC consistently across MariaDB and SQLite.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def safe_filename(filename: str, content_type: str) -> str:
    cleaned = re.sub(r"[\x00-\x1f\x7f]", "", filename.replace("\\", "/").rsplit("/", 1)[-1])[:255]
    return cleaned if cleaned and cleaned not in {".", ".."} else f"image.{IMAGE_EXTENSIONS[content_type]}"


def validate_image(data: bytes, content_type: str) -> None:
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "이미지 한 장의 크기는 5MB 이하여야 합니다.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                image_format = image.format
                if image_format not in IMAGE_FORMATS or image.width * image.height > MAX_IMAGE_PIXELS:
                    raise ValueError("Unsupported image or dimensions")
                image.verify()
            with Image.open(BytesIO(data)) as image:
                image.load()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "올바른 JPG, PNG, GIF, WebP 이미지를 첨부해 주세요.") from None
    if IMAGE_FORMATS[image_format][0] != content_type:
        raise HTTPException(422, "이미지 형식과 파일 내용이 일치하지 않습니다.")


def unavailable() -> HTTPException:
    return HTTPException(503, "이미지 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.")


def _translate_object_error(exc: ClientError) -> None:
    code = str(exc.response.get("Error", {}).get("Code", ""))
    if code in {"404", "NoSuchKey", "NotFound"}:
        raise HTTPException(422, "업로드된 이미지를 찾을 수 없습니다. 이미지를 다시 첨부해 주세요.") from None
    if code in {"412", "PreconditionFailed"}:
        raise HTTPException(422, "첨부 이미지가 변경되었습니다. 이미지를 다시 첨부해 주세요.") from None
    raise exc


class S3ImageStorage:
    def __init__(self, bucket: str | None = None):
        self.bucket = bucket or S3_BUCKET_NAME
        if not self.bucket:
            raise HTTPException(503, "이미지 업로드 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.")
        try:
            self.client = boto3.client(
                "s3", region_name=AWS_REGION,
                config=Config(
                    signature_version="s3v4", connect_timeout=5, read_timeout=15,
                    retries={"mode": "standard", "max_attempts": 2},
                    s3={"addressing_style": "virtual", "us_east_1_regional_endpoint": "regional"},
                ),
            )
        except STORAGE_ERRORS:
            raise unavailable() from None

    @staticmethod
    def new_key(content_type: str, staging: bool = False) -> str:
        prefix = "question-uploads" if staging else "questions"
        return f"{prefix}/{uuid4().hex}.{IMAGE_EXTENSIONS[content_type]}"

    def presign_upload(self, key: str, content_type: str) -> str:
        # Sign Content-Type; browsers set their own Content-Length for File PUTs.
        return self.client.generate_presigned_url(
            "put_object", Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=UPLOAD_URL_SECONDS, HttpMethod="PUT",
        )

    def verify_upload(self, upload: QuestionUpload) -> str:
        """Read bounded bytes under an ETag condition; return the verified ETag."""
        try:
            metadata = self.client.head_object(Bucket=self.bucket, Key=upload.object_key)
            size = metadata.get("ContentLength")
            if not isinstance(size, int) or size <= 0:
                raise HTTPException(422, "빈 이미지 또는 올바르지 않은 업로드입니다.")
            if size > MAX_IMAGE_BYTES:
                raise HTTPException(413, "이미지 한 장의 크기는 5MB 이하여야 합니다.")
            if size != upload.size_bytes or metadata.get("ContentType") != upload.content_type:
                raise HTTPException(422, "첨부 이미지의 크기나 형식이 업로드 요청과 다릅니다.")
            etag = metadata.get("ETag")
            if not isinstance(etag, str) or not etag:
                raise HTTPException(422, "첨부 이미지 정보를 확인할 수 없습니다.")
            result = self.client.get_object(
                Bucket=self.bucket, Key=upload.object_key, IfMatch=etag,
                Range=f"bytes=0-{MAX_IMAGE_BYTES}",
            )
            body = result["Body"]
            try:
                data = body.read(MAX_IMAGE_BYTES + 1)
            finally:
                body.close()
            if len(data) != size:
                raise HTTPException(422, "첨부 이미지의 크기가 올바르지 않습니다.")
            validate_image(data, upload.content_type)
            return etag
        except ClientError as exc:
            _translate_object_error(exc)

    def copy_verified(self, upload: QuestionUpload, final_key: str, etag: str) -> None:
        try:
            self.client.copy_object(
                Bucket=self.bucket, Key=final_key,
                CopySource={"Bucket": self.bucket, "Key": upload.object_key},
                CopySourceIfMatch=etag, MetadataDirective="REPLACE",
                ContentType=upload.content_type, ContentDisposition="inline",
                CacheControl="private, max-age=3600",
            )
        except ClientError as exc:
            _translate_object_error(exc)

    def signed_url(self, key: str) -> str:
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=SIGNED_URL_SECONDS,
        )

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


def cleanup_pending_images(db: Session, limit: int = 100) -> int:
    """Attempt bounded cleanup; failed rows stay durable for the next retry."""
    pending = db.query(PendingS3Deletion).order_by(PendingS3Deletion.id).limit(limit).all()
    deleted = 0
    stores: dict[str, S3ImageStorage] = {}  # boto3 클라이언트 생성은 비싸다(수십 ms). 버킷마다 한 번만 만든다.
    for item in pending:
        try:
            if item.bucket not in stores:
                stores[item.bucket] = S3ImageStorage(item.bucket)
            stores[item.bucket].delete(item.object_key)
        except (*STORAGE_ERRORS, HTTPException):
            logger.warning("Question image cleanup deferred (queue id=%s).", item.id)
            continue
        db.delete(item)
        deleted += 1
    db.commit()
    return deleted


def queue_expired_uploads(db: Session, limit: int = 100) -> int:
    """Retain staging until signed PUT expiry plus an in-flight upload margin."""
    cutoff = utcnow() - timedelta(seconds=STAGING_CLEANUP_GRACE_SECONDS)
    uploads = db.query(QuestionUpload).filter(QuestionUpload.expires_at <= cutoff).order_by(QuestionUpload.expires_at).limit(limit).with_for_update().all()
    for upload in uploads:
        db.add(PendingS3Deletion(bucket=upload.bucket, object_key=upload.object_key))
        db.delete(upload)
    db.commit()
    return len(uploads)
