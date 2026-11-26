"""Join room locations and channel job history migration branches."""

revision = "0033_merge_room_history"
down_revision = ("0032_channel_job_history", "0032_room_locations")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
