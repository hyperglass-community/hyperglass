"""Manage share snapshots from the command line (#559)."""

# Third Party
import typer

# Local
from .echo import echo

share = typer.Typer(help="List and delete share snapshots", no_args_is_help=True)


def _instance():
    # Project
    from hyperglass.state import use_state

    return use_state("redis").instance


@share.command(name="list")
def _list() -> None:
    """List live shares."""
    # Project
    from hyperglass.share import list_shares

    shares = list_shares(_instance())
    if not shares:
        echo.info("No shares")
        return

    # One tab-separated line per result, so IDs are never cut and lines can be filtered.
    typer.echo("\t".join(("ID", "Created", "Expires", "Location", "Query Type", "Target")))
    for share_id, stored in shares:
        if stored.snapshot is None:
            typer.echo(f"{share_id}\t({stored.status})")
            continue
        snapshot = stored.snapshot
        for result in snapshot.results:
            target = result.query.target
            row = (
                share_id,
                snapshot.created_at.isoformat(),
                snapshot.expires_at.isoformat(),
                result.labels.location,
                result.labels.query_type,
                ", ".join(target) if isinstance(target, list) else target,
            )
            typer.echo("\t".join(row))


@share.command(name="delete")
def _delete(share_id: str = typer.Argument(..., help="Share ID")) -> None:
    """Delete a share."""
    # Project
    from hyperglass.share import delete_share

    if not delete_share(_instance(), share_id):
        echo.error("Share {!s} not found", share_id)
        raise typer.Exit(1)
    echo.success("Deleted share {!s}", share_id)


@share.command(name="clear")
def _clear(
    yes: bool = typer.Option(False, "--yes", "-y", help="Don't ask for confirmation"),
) -> None:
    """Delete every share."""
    # Project
    from hyperglass.share import clear_shares

    if not yes:
        typer.confirm("Delete every share? Links to them will stop working", abort=True)
    deleted = clear_shares(_instance())
    echo.success("Deleted {!s} keys under hyperglass.share:", deleted)
