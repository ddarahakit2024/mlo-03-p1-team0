"""Retry deferred S3 deletions: python -m app.scripts.s3_cleanup."""

from datetime import timedelta

from app.core.question_images import STAGING_CLEANUP_GRACE_SECONDS, cleanup_pending_images, queue_expired_uploads, utcnow
from app.db.database import SessionLocal
from app.models.question import PendingS3Deletion, QuestionUpload


def main() -> int:
    with SessionLocal() as db:
        queued = queue_expired_uploads(db)
        deleted = cleanup_pending_images(db)
        remaining = db.query(PendingS3Deletion).count()
        remaining += db.query(QuestionUpload).filter(
            QuestionUpload.expires_at <= utcnow() - timedelta(seconds=STAGING_CLEANUP_GRACE_SECONDS)
        ).count()
    print(f"Expired uploads queued: {queued}; deleted: {deleted}; pending: {remaining}")
    return 1 if remaining else 0


if __name__ == "__main__":
    raise SystemExit(main())
