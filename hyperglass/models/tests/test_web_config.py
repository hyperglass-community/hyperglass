"""Test web configuration models."""

# Third Party
import pytest
from pydantic import ValidationError

# Project
from hyperglass.constants import DNS_OVER_HTTPS

# Local
from ..config.web import Web, Logo, Text, History, DnsOverHttps


@pytest.mark.parametrize("value", (50, "50", "50%"))
def test_logo_width_normalised(value):
    """A bare width keeps validating and gains a `%` (#177)."""
    assert Logo(width=value).width == "50%"


def test_logo_width_default():
    assert Logo().width == "50%"


@pytest.mark.parametrize("value", (25, "25", "25%"))
def test_logo_height_accepted(value):
    """Height stays accepted and is normalised like width (#177)."""
    assert Logo(height=value).height == "25%"


def test_logo_height_default():
    assert Logo().height is None


@pytest.mark.parametrize("value", ("0", "101", "50px", "abc", True))
def test_logo_width_invalid(value):
    with pytest.raises(ValidationError):
        Logo(width=value)


@pytest.mark.parametrize(
    "data,expected",
    (
        ({}, ("cloudflare", DNS_OVER_HTTPS["cloudflare"])),
        ({"name": "google"}, ("google", DNS_OVER_HTTPS["google"])),
        ({"name": "server"}, ("server", DNS_OVER_HTTPS["server"])),
        ({"name": "custom", "url": "https://doh.example/q"}, ("custom", "https://doh.example/q")),
        ({"url": "https://doh.example/q"}, ("custom", "https://doh.example/q")),
    ),
)
def test_dns_provider_valid(data, expected):
    model = DnsOverHttps(**data)
    assert (model.name, model.url) == expected


@pytest.mark.parametrize("data", ({"name": "custom"}, {"name": "quad8"}))
def test_dns_provider_invalid(data):
    """An unknown name, or custom without url, names the key and the providers (#178)."""
    with pytest.raises(ValidationError) as err:
        DnsOverHttps(**data)
    message = str(err.value)
    assert "web.dns_provider" in message
    for name in DNS_OVER_HTTPS:
        assert name in message


def test_result_button_text_defaults():
    """The icon-only result buttons keep their English labels by default (#533)."""
    text = Text()
    assert (text.copy_output, text.reload_query, text.view_as_path) == (
        "Copy Output",
        "Reload Query",
        "View AS Path",
    )


def test_result_button_text_exported_camel_case():
    """The UI reads the labels as camelCase keys of `web.text`."""
    exported = Text(copy_output="Copier").model_dump(by_alias=True)
    assert exported["copyOutput"] == "Copier"
    assert exported["reloadQuery"] == "Reload Query"
    assert exported["viewAsPath"] == "View AS Path"


def test_copy_link_text_defaults():
    """The copy link button's text defaults to English and is exported as camelCase (#577)."""
    text = Text()
    assert (text.copy_link, text.link_copied, text.query_link) == (
        "Copy Link",
        "Link copied",
        "Link to this query",
    )
    exported = Text(copy_link="Copier le lien").model_dump(by_alias=True)
    assert exported["copyLink"] == "Copier le lien"
    assert exported["linkCopied"] == "Link copied"
    assert exported["queryLink"] == "Link to this query"


def test_as_path_and_pagination_text_defaults():
    """The AS path chart and table pagination text defaults to English (#541)."""
    text = Text()
    assert text.as_path_title == "Path to {target}"
    assert (text.zoom_in, text.zoom_out, text.fit_nodes) == ("Zoom In", "Zoom Out", "Fit Nodes")
    assert (text.first_page, text.previous_page, text.next_page, text.last_page) == (
        "First Page",
        "Previous Page",
        "Next Page",
        "Last Page",
    )


def test_as_path_and_pagination_text_exported_camel_case():
    """The UI reads the text as camelCase keys of `web.text`."""
    exported = Text(as_path_title="Chemin vers {target}").model_dump(by_alias=True)
    assert exported["asPathTitle"] == "Chemin vers {target}"
    for key in (
        "zoomIn",
        "zoomOut",
        "fitNodes",
        "firstPage",
        "previousPage",
        "nextPage",
        "lastPage",
    ):
        assert key in exported


def test_page_size_and_page_count_text():
    """The table's page size select and page count read `web.text`, in English by default (#548)."""
    text = Text()
    assert (text.page_size, text.page_size_option, text.page_count) == (
        "Rows per page",
        "Show {count}",
        "Page {page} of {pages}",
    )
    exported = Text(page_count="Page {page} sur {pages}").model_dump(by_alias=True)
    assert exported["pageCount"] == "Page {page} sur {pages}"
    assert exported["pageSize"] == "Rows per page"
    assert exported["pageSizeOption"] == "Show {count}"


def test_cache_icon_default_has_no_time_zone():
    """The UI shows `{time}` in the viewer's time zone, so the default doesn't say UTC (#551)."""
    assert Text().cache_icon == "Cached from {time}"


def test_history_defaults():
    """Query history is on, keeping 10 entries per browser, by default (#556)."""
    history = Web().history
    assert (history.enable, history.limit) == (True, 10)


@pytest.mark.parametrize("limit", (1, 50))
def test_history_limit_valid(limit):
    assert History(limit=limit).limit == limit


@pytest.mark.parametrize("limit", (0, -1, 51))
def test_history_limit_invalid(limit):
    with pytest.raises(ValidationError):
        History(limit=limit)


def test_history_exported():
    """The UI reads `web.history` and the history text as camelCase keys."""
    exported = Web(history={"enable": False, "limit": 3}).model_dump(by_alias=True)
    assert exported["history"] == {"enable": False, "limit": 3}
    assert {
        "historyTitle": "Recent queries",
        "historyOpen": "Open",
        "historyDelete": "Delete",
        "historyClearAll": "Clear all",
        "historyClearConfirm": "Delete all saved queries from this browser?",
        "historyClearCancel": "Cancel",
        "historyBack": "Back",
        "historySavedAt": "Saved {time}",
    }.items() <= exported["text"].items()


def test_share_page_text_exported():
    """The shared result page reads its text as camelCase keys of `web.text` (#560)."""
    exported = Text(share_run_query="Lancer cette requête").model_dump(by_alias=True)
    assert {
        "shareTitle": "Shared result",
        "shareLoading": "Loading the shared result...",
        "shareError": "The shared result could not be loaded. Please try again later.",
        "shareResultTime": "Result from {time}",
        "shareExpires": "Link expires {time}",
        "shareRunQuery": "Lancer cette requête",
        "shareNewQuery": "New query",
    }.items() <= exported.items()


def test_share_button_text_exported():
    """The Share button and its popover read their text as camelCase keys of `web.text` (#561)."""
    exported = Text(share_delete="Supprimer le lien").model_dump(by_alias=True)
    assert {
        "shareResult": "Share Result",
        "shareKeepFor": "Keep for",
        "shareCreate": "Create Link",
        "shareLink": "Link to this result",
        "shareNotice": "Anyone with the link can see this result, including the target.",
        "shareDelete": "Supprimer le lien",
        "shareDeleted": "Link deleted",
        "shareEarlierLink": "Link to the result from {time}",
        "shareDeleteScope": "You can delete the link from this browser, here or under {shares}, until it expires.",
        "shareDeleteRotated": "This link can't be deleted from this browser any more: the result was shared again elsewhere. It works until it expires.",
        "shareLinkExpired": "The link has expired.",
        "shareMinute": "{count} minute",
        "shareMinutes": "{count} minutes",
        "shareHour": "{count} hour",
        "shareHours": "{count} hours",
        "shareDay": "{count} day",
        "shareDays": "{count} days",
    }.items() <= exported.items()


def test_shared_links_text_exported():
    """The shared links list and the history's share mark read camelCase keys of `web.text` (#562)."""
    exported = Text(shares_title="Mes liens").model_dump(by_alias=True)
    assert {
        "sharesTitle": "Mes liens",
        "sharesForget": "Forget",
        "sharesClearAll": "Forget all",
        "sharesClearConfirm": (
            "Forget every shared link in this browser? The links keep working until they "
            "expire, and can no longer be deleted from here."
        ),
        "sharesClearCancel": "Cancel",
        "shareDeleteScopePage": "You can delete the link from this page until you close or reload it.",
        "historyShared": "Link shared",
        "historyShareKept": (
            "Deleting saved queries doesn't delete their share links: they stay under "
            "{shares} and keep working until they expire."
        ),
    }.items() <= exported.items()


def test_form_button_and_route_table_text():
    """The form buttons and the route table's labels are configurable text (#581)."""
    exported = Text(submit_query="Envoyer").model_dump(by_alias=True)
    assert {
        "resetForm": "Reset",
        "submitQuery": "Envoyer",
        "asPathInternal": "Internal",
        "asPathAsn": "AS{asn}",
        "noValue": "N/A",
        "weightLowPreferred": "Lower Weight is Preferred",
        "weightHighPreferred": "Higher Weight is Preferred",
    }.items() <= exported.items()


def test_no_common_query_types_text():
    """The error for locations without a query type in common is configurable (#521)."""
    assert Text().no_common_query_types == (
        "{query_location_plural} {locations} have no {query_type_plural} in common."
    )
    exported = Text(no_common_query_types="{locations}: aucun type commun").model_dump(
        by_alias=True
    )
    assert exported["noCommonQueryTypes"] == "{locations}: aucun type commun"


def test_locale_default_is_english():
    """The route table's age stays English unless a locale is set (#605)."""
    assert Web().locale == "en"


@pytest.mark.parametrize("value", ("fr", "pt-BR", "zh-Hant-TW", "de-CH", "es-419", "tlh"))
def test_locale_accepts_language_tags(value):
    assert Web(locale=value).locale == value


@pytest.mark.parametrize(
    "value", ("", "f", "french!", "fr_CA", "fr-", "../fr", "en-x", "de-1", "fr-CA-CA")
)
def test_locale_rejects_other_values(value):
    """Only a language, script and region: the browser rejects a malformed tag (#605)."""
    with pytest.raises(ValidationError):
        Web(locale=value)
