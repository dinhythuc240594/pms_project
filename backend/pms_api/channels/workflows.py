"""Forward recovery for OTA booking revisions using the durable ACK job.

The worker commits the import and queued ACK together. A subsequent job performs
the remote ACK only after a committed receipt can be read. Remote writes cannot
be undone safely, so retry resumes from the durable receipt instead of cancelling
the guest's booking as compensation.
"""

from .errors import ProviderError
from .ports import ChannelAdapter, RevisionRepository


class BookingRevisionWorkflow:
    def __init__(self, adapter: ChannelAdapter, repository: RevisionRepository, importer):
        self.adapter = adapter
        self.repository = repository
        self.importer = importer

    def fetch_and_import(self, tenant_id, property_id, revision_id):
        """Import only; the worker releases its queue slot before scheduling the ACK."""
        entity = self.adapter.revision(revision_id)
        if not isinstance(entity, dict) or entity.get("id") != revision_id:
            raise ProviderError("provider_invalid_response")
        return self.importer(tenant_id, entity, property_id)

    def receive(self, tenant_id, actor_id, property_id, revision_id):
        receipt = self.fetch_and_import(tenant_id, property_id, revision_id)
        self.repository.enqueue_ack(tenant_id, actor_id, receipt.revision_id)
        return receipt

    def acknowledge(self, tenant_id, revision_id):
        if not self.repository.has_revision(tenant_id, revision_id):
            raise ProviderError("channel_commit_required")
        self.adapter.ack(revision_id)
