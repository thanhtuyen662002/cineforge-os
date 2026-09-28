#!/usr/bin/env python3
"""Validate canonical CineForge control-event streams.

The validator is intentionally dependency-free.  It checks the exact
ASCII-keyed ``KEY=VALUE`` grammar, envelope/payload schemas, canonical
SHA-256 event hashes, and the small amount of cross-field state needed to
prevent unsafe control-plane transitions.  It cannot authenticate a GitHub
author or query live refs; those checks remain external reconciliation gates.

Usage examples::

    python docs/orchestration/control_event_lint.py event.txt
    python docs/orchestration/control_event_lint.py --expected-head <sha> event.txt
    python docs/orchestration/control_event_lint.py first.txt second.txt

Multiple files are interpreted in stream order.  An identical retry with the
same CONTROL_EVENT_ID is idempotent; a different payload with that ID fails.
An UNKNOWN_OUTCOME merge event fences later acquire/takeover mutations for the
same merge operation until a direct reconciliation event is supplied.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence


HERE = Path(__file__).resolve().parent
DEFAULT_SCHEMA = HERE / "CONTROL_EVENT_CONTRACTS.json"
MACHINE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

REQUIRED_EVENT_SCHEMAS = {
    "AGENT_STATE_V1",
    "AGENT_TAKEOVER_V1",
    "AGENT_REVIEW_V1",
    "TASK_CONTRACT_REVISION_V1",
    "ORPHAN_OBSERVED_V1",
    "CLAIM_INTENT_V1",
    "CAPACITY_PLAN_V2",
    "SLOT_LEASE_V1",
    "CONTROL_ROLE_LEASE_V1",
    "MERGE_LEASE_V1",
    "CI_VERIFICATION_V1",
    "MERGE_OUTCOME_V1",
}


class EventValidationError(ValueError):
    """Raised for one malformed or unsafe event."""


@dataclass(frozen=True)
class ParsedEvent:
    """A validated event and its canonicalized key/value payload."""

    values: Mapping[str, str]
    canonical_hash: str

    @property
    def event_schema(self) -> str:
        return self.values["EVENT_SCHEMA"]

    @property
    def event_id(self) -> str:
        return self.values["CONTROL_EVENT_ID"]


def load_schema(path: Path = DEFAULT_SCHEMA) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise EventValidationError(f"cannot load schema {path}: {exc}") from exc
    errors = validate_schema_definition(value)
    if errors:
        raise EventValidationError("invalid control-event schema: " + "; ".join(errors))
    return value


def validate_schema_definition(schema: object) -> list[str]:
    """Validate the schema file itself before using any of its rules."""
    errors: list[str] = []
    if not isinstance(schema, dict):
        return ["schema root must be an object"]
    if schema.get("schema_id") != "cineforge-control-event-contracts":
        errors.append("schema_id is unsupported")
    if schema.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    if schema.get("encoding") != "UTF-8":
        errors.append("encoding must be UTF-8")
    if schema.get("machine_key_pattern") != MACHINE_KEY_RE.pattern:
        errors.append("machine_key_pattern is unsupported")
    hashing = schema.get("hashing")
    if not isinstance(hashing, dict) or hashing.get("algorithm") != "SHA-256":
        errors.append("hashing algorithm must be SHA-256")
    formats = schema.get("formats")
    if not isinstance(formats, dict) or not formats:
        errors.append("formats must be a non-empty object")
    else:
        for name, definition in formats.items():
            if not isinstance(name, str) or not isinstance(definition, dict):
                errors.append(f"format {name!r} must be an object")
                continue
            pattern = definition.get("pattern")
            maximum = definition.get("max_length")
            if not isinstance(pattern, str) or not isinstance(maximum, int) or maximum < 1:
                errors.append(f"format {name!r} needs pattern and positive max_length")
                continue
            try:
                re.compile(pattern)
            except re.error as exc:
                errors.append(f"format {name!r} has invalid regex: {exc}")
    envelope = schema.get("envelope")
    if not isinstance(envelope, dict):
        errors.append("envelope must be an object")
    else:
        required = envelope.get("required")
        fields = envelope.get("fields")
        if not isinstance(required, list) or not isinstance(fields, dict):
            errors.append("envelope needs required and fields")
        else:
            if set(required) != set(fields):
                errors.append("envelope required/fields mismatch")
            if len(required) != len(set(required)):
                errors.append("envelope has duplicate required fields")
    events = schema.get("events")
    if not isinstance(events, dict):
        errors.append("events must be an object")
        return errors
    if set(events) != REQUIRED_EVENT_SCHEMAS:
        errors.append(
            "event schema set mismatch: "
            f"expected {sorted(REQUIRED_EVENT_SCHEMAS)}, found {sorted(events)}"
        )
    envelope_fields = set((envelope or {}).get("fields", {})) if isinstance(envelope, dict) else set()
    for event_name, definition in events.items():
        if not isinstance(event_name, str) or not isinstance(definition, dict):
            errors.append(f"event {event_name!r} must be an object")
            continue
        if not re.fullmatch(r"[A-Z][A-Z0-9_]+_V[1-9][0-9]*", event_name):
            errors.append(f"event {event_name!r} has invalid versioned name")
        required = definition.get("required")
        fields = definition.get("fields")
        if not isinstance(required, list) or not isinstance(fields, dict):
            errors.append(f"event {event_name!r} needs required and fields")
            continue
        if set(required) != set(fields):
            errors.append(f"event {event_name!r} required/fields mismatch")
        if len(required) != len(set(required)):
            errors.append(f"event {event_name!r} has duplicate required fields")
        if envelope_fields.intersection(fields):
            errors.append(f"event {event_name!r} redeclares envelope fields")
        for field, field_rule in fields.items():
            if not isinstance(field, str) or not MACHINE_KEY_RE.fullmatch(field):
                errors.append(f"event {event_name!r} has invalid field {field!r}")
                continue
            if not isinstance(field_rule, dict):
                errors.append(f"event {event_name!r} field {field} must be an object")
                continue
            has_format = isinstance(field_rule.get("format"), str)
            enum = field_rule.get("enum")
            has_enum = isinstance(enum, list) and bool(enum)
            if has_format == has_enum:
                errors.append(f"event {event_name!r} field {field} needs exactly one format or enum")
            if has_enum and len(enum) != len(set(enum)):
                errors.append(f"event {event_name!r} field {field} repeats enum values")
            if has_format and field_rule["format"] not in formats:
                errors.append(f"event {event_name!r} field {field} uses unknown format")
    return errors


def _schema_limits(schema: Mapping[str, object]) -> tuple[int, int]:
    event_bytes = schema.get("max_event_bytes", 32768)
    line_bytes = schema.get("max_line_bytes", 4096)
    if not isinstance(event_bytes, int) or event_bytes < 1 or not isinstance(line_bytes, int) or line_bytes < 1:
        raise EventValidationError("schema size limits are invalid")
    return event_bytes, line_bytes


def _field_error(field: str, value: str, rule: Mapping[str, object], schema: Mapping[str, object]) -> str | None:
    enum = rule.get("enum")
    if isinstance(enum, list):
        if value not in enum:
            return f"field {field} has unsupported value {value!r}"
        return None
    format_name = rule.get("format")
    formats = schema.get("formats")
    if not isinstance(format_name, str) or not isinstance(formats, dict):
        return f"field {field} has no usable format"
    definition = formats.get(format_name)
    if not isinstance(definition, dict):
        return f"field {field} uses unknown format {format_name!r}"
    maximum = definition.get("max_length")
    pattern = definition.get("pattern")
    if not isinstance(maximum, int) or not isinstance(pattern, str):
        return f"field {field} uses malformed format {format_name!r}"
    if len(value) > maximum:
        return f"field {field} exceeds {maximum} characters"
    try:
        matches = re.fullmatch(pattern, value)
    except re.error as exc:
        return f"field {field} format is invalid: {exc}"
    if not matches:
        return f"field {field} does not match {format_name}"
    return None


def canonical_event_hash(values: Mapping[str, str]) -> str:
    """Hash sorted event lines, excluding the self-referential EVENT_HASH."""
    payload = "".join(
        f"{key}={values[key]}\n"
        for key in sorted(values)
        if key != "EVENT_HASH"
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def _cross_field_errors(values: Mapping[str, str]) -> list[str]:
    event = values["EVENT_SCHEMA"]
    errors: list[str] = []
    previous_comment = values["PREV_EVENT_COMMENT_ID"]
    previous_hash = values["PREV_EVENT_HASH"]
    if (previous_comment == "none") != (previous_hash == "none"):
        errors.append("PREV_EVENT_COMMENT_ID and PREV_EVENT_HASH must be both none or both present")

    if event == "AGENT_STATE_V1":
        if values["STATE"] == "READY_FOR_MERGE" and values["BLOCKER"].lower() != "none":
            errors.append("READY_FOR_MERGE requires BLOCKER=none")
        if values["STATE"] == "ABANDONED" and values["BLOCKER"].lower() == "none":
            errors.append("ABANDONED requires a non-none BLOCKER")
    elif event == "AGENT_TAKEOVER_V1":
        if values["FROM"] == values["TO"]:
            errors.append("takeover FROM and TO must differ")
    elif event == "AGENT_REVIEW_V1":
        if values["VERDICT"] == "APPROVE" and values["BLOCKERS"].lower() != "none":
            errors.append("APPROVE requires BLOCKERS=none")
        if values["VERDICT"] == "REQUEST_CHANGES" and values["BLOCKERS"].lower() == "none":
            errors.append("REQUEST_CHANGES requires a non-none BLOCKERS value")
    elif event == "TASK_CONTRACT_REVISION_V1":
        if values["PREV_CONTRACT_HASH"] == values["NEW_CONTRACT_HASH"]:
            errors.append("contract revision must change the contract hash")
    elif event == "CAPACITY_PLAN_V2":
        limits = [
            "MAX_ACTIVE_IMPLEMENTATION",
            "MAX_CI_IN_FLIGHT",
            "MAX_WAITING_REVIEW",
            "MAX_PARKED_TOTAL",
        ]
        if int(values["MAX_ACTIVE_IMPLEMENTATION"]) > int(values["SLOT_COUNT"]):
            errors.append("MAX_ACTIVE_IMPLEMENTATION cannot exceed SLOT_COUNT")
        if int(values["MAX_WAITING_REVIEW"]) + int(values["MAX_ACTIVE_IMPLEMENTATION"]) > int(values["MAX_PARKED_TOTAL"]) + int(values["SLOT_COUNT"]):
            errors.append("capacity plan has contradictory WIP limits")
        if any(int(values[name]) < 0 for name in limits):
            errors.append("capacity limits must be non-negative")
    elif event in {"SLOT_LEASE_V1", "CONTROL_ROLE_LEASE_V1", "MERGE_LEASE_V1"}:
        if values["ACTION"] == "RELEASE" and values["TTL_SECONDS"] != "0":
            errors.append("RELEASE requires TTL_SECONDS=0")
        if values["ACTION"] != "RELEASE" and values["TTL_SECONDS"] == "0":
            errors.append("ACQUIRE, RENEW and TAKEOVER require a positive TTL_SECONDS")
    elif event == "CI_VERIFICATION_V1":
        if values["RESULT"] == "PASS" and values["RUNNER_TRUST_CLASS"] == "UNKNOWN":
            errors.append("PASS cannot use RUNNER_TRUST_CLASS=UNKNOWN")
    elif event == "MERGE_OUTCOME_V1":
        outcome = values["OUTCOME"]
        if outcome == "CONFIRMED_SUCCESS":
            if values["OBSERVED_MERGED_SHA"] == "none" or values["RECONCILIATION_SOURCE"] == "NONE":
                errors.append("CONFIRMED_SUCCESS requires observed merge SHA and reconciliation source")
        if outcome == "UNKNOWN_OUTCOME":
            if values["RECONCILIATION_SOURCE"] != "NONE":
                errors.append("UNKNOWN_OUTCOME must use RECONCILIATION_SOURCE=NONE")
            if values["OBSERVED_MERGED_SHA"] != "none":
                errors.append("UNKNOWN_OUTCOME must not assert an observed merge SHA")
    return errors


def parse_event_text(text: str, schema: Mapping[str, object]) -> ParsedEvent:
    """Parse and validate one canonical event text block."""
    if not isinstance(text, str):
        raise EventValidationError("event input must be text")
    max_event_bytes, max_line_bytes = _schema_limits(schema)
    encoded = text.encode("utf-8")
    if len(encoded) > max_event_bytes:
        raise EventValidationError(f"event exceeds {max_event_bytes} UTF-8 bytes")
    values: dict[str, str] = {}
    lines = text.splitlines()
    while lines and lines[-1] == "":
        lines.pop()
    if not lines:
        raise EventValidationError("event is empty")
    for line_number, line in enumerate(lines, 1):
        if not line:
            raise EventValidationError(f"line {line_number} is blank; events cannot contain blank lines")
        if len(line.encode("utf-8")) > max_line_bytes:
            raise EventValidationError(f"line {line_number} exceeds {max_line_bytes} UTF-8 bytes")
        if "=" not in line:
            raise EventValidationError(f"line {line_number} is not KEY=VALUE")
        key, value = line.split("=", 1)
        if not MACHINE_KEY_RE.fullmatch(key):
            raise EventValidationError(f"line {line_number} has invalid ASCII machine key {key!r}")
        if CONTROL_CHAR_RE.search(value):
            raise EventValidationError(f"line {line_number} contains a control character")
        if key in values:
            raise EventValidationError(f"duplicate event key {key}")
        values[key] = value

    envelope = schema["envelope"]
    assert isinstance(envelope, dict)
    required_envelope = envelope["required"]
    assert isinstance(required_envelope, list)
    event_name = values.get("EVENT_SCHEMA")
    if event_name not in schema["events"]:
        raise EventValidationError(f"unknown EVENT_SCHEMA/version {event_name!r}")
    events = schema["events"]
    assert isinstance(events, dict)
    event_definition = events[event_name]
    assert isinstance(event_definition, dict)
    required_payload = event_definition["required"]
    assert isinstance(required_payload, list)
    required = list(required_envelope) + list(required_payload)
    missing = [key for key in required if key not in values]
    if missing:
        raise EventValidationError("missing required fields: " + ",".join(missing))
    allowed = set(required)
    unknown = sorted(set(values) - allowed)
    if unknown:
        raise EventValidationError("unknown fields: " + ",".join(unknown))

    envelope_fields = envelope["fields"]
    assert isinstance(envelope_fields, dict)
    event_fields = event_definition["fields"]
    assert isinstance(event_fields, dict)
    for field, rule in list(envelope_fields.items()) + list(event_fields.items()):
        assert isinstance(rule, dict)
        error = _field_error(field, values[field], rule, schema)
        if error:
            raise EventValidationError(error)
    errors = _cross_field_errors(values)
    if errors:
        raise EventValidationError("; ".join(errors))
    expected_hash = canonical_event_hash(values)
    if values["EVENT_HASH"] != expected_hash:
        raise EventValidationError(
            f"EVENT_HASH does not match canonical SHA-256 (expected {expected_hash})"
        )
    return ParsedEvent(values=dict(values), canonical_hash=expected_hash)


def validate_expected_context(
    event: ParsedEvent,
    *,
    expected_head: str | None = None,
    expected_base: str | None = None,
    expected_producer: str | None = None,
) -> list[str]:
    """Apply optional live-fact bindings supplied by an external reconciler."""
    values = event.values
    errors: list[str] = []
    if expected_head:
        head_fields = {
            "AGENT_REVIEW_V1": "REVIEW_HEAD_SHA",
            "CI_VERIFICATION_V1": "HEAD_SHA",
            "MERGE_LEASE_V1": "EXPECTED_PR_HEAD_SHA",
        }
        field = head_fields.get(event.event_schema)
        if field and values[field] != expected_head:
            errors.append(f"{event.event_schema} {field} is stale for expected HEAD_SHA")
    if expected_base:
        base_fields = {
            "AGENT_REVIEW_V1": "REVIEW_BASE_SHA",
            "CI_VERIFICATION_V1": "BASE_SHA",
            "MERGE_LEASE_V1": "EXPECTED_MAIN_SHA",
        }
        field = base_fields.get(event.event_schema)
        if field and values[field] != expected_base:
            errors.append(f"{event.event_schema} {field} is stale for expected BASE_SHA")
    if expected_producer and event.event_schema == "CI_VERIFICATION_V1":
        if values["CHECK_PRODUCER_IDENTITY"] != expected_producer:
            errors.append("CI_VERIFICATION_V1 has an unexpected check producer identity")
    return errors


def validate_event_stream(
    texts: Sequence[str],
    schema: Mapping[str, object],
    *,
    expected_head: str | None = None,
    expected_base: str | None = None,
    expected_producer: str | None = None,
) -> tuple[list[ParsedEvent], list[str]]:
    """Validate events in order and reconcile retry/idempotency semantics."""
    parsed: list[ParsedEvent] = []
    errors: list[str] = []
    by_id: dict[str, ParsedEvent] = {}
    merge_outcomes: dict[str, str] = {}
    for index, text in enumerate(texts, 1):
        try:
            event = parse_event_text(text, schema)
        except EventValidationError as exc:
            errors.append(f"event {index}: {exc}")
            continue
        errors.extend(
            f"event {index}: {message}"
            for message in validate_expected_context(
                event,
                expected_head=expected_head,
                expected_base=expected_base,
                expected_producer=expected_producer,
            )
        )
        prior = by_id.get(event.event_id)
        if prior is not None:
            if dict(prior.values) != dict(event.values):
                errors.append(
                    f"event {index}: CONTROL_EVENT_ID {event.event_id} has conflicting payloads"
                )
            continue
        by_id[event.event_id] = event
        parsed.append(event)
        if event.event_schema == "MERGE_OUTCOME_V1":
            merge_outcomes[event.values["MERGE_OPERATION_ID"]] = event.values["OUTCOME"]
        elif (
            event.event_schema == "MERGE_LEASE_V1"
            and event.values["ACTION"] in {"ACQUIRE", "TAKEOVER"}
            and merge_outcomes.get(event.values["MERGE_OPERATION_ID"]) == "UNKNOWN_OUTCOME"
        ):
            errors.append(
                f"event {index}: merge mutation is fenced after UNKNOWN_OUTCOME; reconcile first"
            )
    return parsed, errors


def _read_path(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    try:
        return Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise EventValidationError(f"cannot read {path}: {exc}") from exc


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", default=["-"], help="event files in stream order, or - for stdin")
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--expected-head", help="optional live PR HEAD SHA binding")
    parser.add_argument("--expected-base", help="optional live main/base SHA binding")
    parser.add_argument("--expected-producer", help="optional expected CI producer identity")
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        schema = load_schema(args.schema)
        texts = [_read_path(path) for path in args.paths]
        events, errors = validate_event_stream(
            texts,
            schema,
            expected_head=args.expected_head,
            expected_base=args.expected_base,
            expected_producer=args.expected_producer,
        )
    except EventValidationError as exc:
        print("CONTROL_EVENT_LINT=FAIL")
        print(f"ERROR: {exc}")
        return 1
    if errors:
        print("CONTROL_EVENT_LINT=FAIL")
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(f"CONTROL_EVENT_LINT=PASS events={len(events)} unique_event_ids={len({event.event_id for event in events})}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
