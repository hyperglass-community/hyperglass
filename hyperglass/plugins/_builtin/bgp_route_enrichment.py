"""ASN organization enrichment for structured BGP route data."""

# Standard Library
import typing as t
import asyncio

# Third Party
from pydantic import PrivateAttr

# Project
from hyperglass.log import log
from hyperglass.plugins._output import OutputPlugin
from hyperglass.models.data.bgp_route import BGPRouteTable

if t.TYPE_CHECKING:
    # Project
    from hyperglass.models.data import OutputDataModel
    from hyperglass.models.api.query import Query


class ZBgpRouteEnrichment(OutputPlugin):
    """Enrich structured BGP route output with ASN organization data."""

    _hyperglass_builtin: bool = PrivateAttr(True)
    # Common plugins select by output model, not platform or directive ID.
    platforms: t.Sequence[str] = ()
    directives: t.Sequence[str] = ()
    common: bool = True

    async def enrich(self, output: BGPRouteTable) -> None:
        """Run both AS path and next-hop enrichment."""
        await output.enrich_as_path_organizations()
        await output.enrich_with_ip_enrichment()

    def process(self, *, output: "OutputDataModel", query: "Query") -> "OutputDataModel":
        """Enrich structured BGP route data in the output-processing worker thread."""

        if not isinstance(output, BGPRouteTable):
            return output

        _log = log.bind(plugin=self.__class__.__name__)

        # Check if BGP route enrichment is enabled in config
        try:
            # Project
            from hyperglass.state import use_state
            from hyperglass.settings import Settings

            params = use_state("params")
            if params.structured.ip_enrichment.mode == "async":
                return output
            # If structured config missing or BGP route enrichment disabled, skip
            if (
                not getattr(params, "structured", None)
                or not params.structured.ip_enrichment.enrich_bgproute
                or getattr(params.structured, "enable_for_bgp_route", None) is False
            ):
                if Settings.debug:
                    _log.debug("ASN enrichment for BGP routes disabled in configuration")
                return output

            _log.info(f"Starting ASN and next-hop enrichment for {len(output.routes)} BGP routes")

            # Output plugins run in a worker thread with no event loop (see
            # `Connection.response`), so this does not block the request loop.
            asyncio.run(self.enrich(output))

            enriched_asn_count = len(output.asn_organizations)
            enriched_nexthop_count = sum(1 for r in output.routes if r.next_hop_org)
            _log.info(
                f"Enriched {enriched_asn_count} unique ASNs and "
                f"{enriched_nexthop_count} next-hops with organization data"
            )

        except Exception as e:
            _log.error(f"BGP route enrichment failed: {e}")
            # Don't fail the entire request if enrichment fails

        return output
