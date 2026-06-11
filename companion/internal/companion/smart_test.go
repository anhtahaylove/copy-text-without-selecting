package companion

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestSmartFormatAndActions(t *testing.T) {
	if DetectFormat("{\"ok\":true}") != "json" {
		t.Fatal("expected json format")
	}
	if got := ApplyAction("{\"ok\":true}", "prettyJson"); !strings.Contains(got, "\n  \"ok\"") {
		t.Fatalf("expected pretty json, got %q", got)
	}
	if got := ApplyAction("select * from users where id=1", "formatSql"); !strings.Contains(got, "\nFROM") {
		t.Fatalf("expected formatted sql, got %q", got)
	}
	if got := ApplyAction("Hello world", "snake"); got != "hello_world" {
		t.Fatalf("expected snake case, got %q", got)
	}
}

func TestDecodeJWT(t *testing.T) {
	header := base64.RawURLEncoding.EncodeToString([]byte("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"))
	payload := base64.RawURLEncoding.EncodeToString([]byte("{\"sub\":\"123\"}"))
	decoded := ApplyAction(header+"."+payload+".signature", "decodeJwt")
	if !strings.Contains(decoded, "HEADER") || !strings.Contains(decoded, "\"sub\": \"123\"") {
		t.Fatalf("unexpected jwt decode output: %s", decoded)
	}
}

func TestSQLActionsPreserveStringLiteralsAndComments(t *testing.T) {
	sql := "select 'from  literal' as value -- keep  comment\nfrom users where note='order by text'"
	formatted := ApplyAction(sql, "formatSql")
	if !strings.Contains(formatted, "'from  literal'") {
		t.Fatalf("formatSql changed string literal: %q", formatted)
	}
	if !strings.Contains(formatted, "-- keep  comment") {
		t.Fatalf("formatSql changed comment: %q", formatted)
	}
	if !strings.Contains(formatted, "\nFROM users") {
		t.Fatalf("formatSql did not format SQL clause: %q", formatted)
	}

	minified := ApplyAction(sql, "minifySql")
	if !strings.Contains(minified, "'order by text'") || !strings.Contains(minified, "-- keep  comment") {
		t.Fatalf("minifySql changed protected SQL text: %q", minified)
	}
}

func TestBase64DetectionIsStrict(t *testing.T) {
	if DetectFormat(base64.StdEncoding.EncodeToString([]byte("Hello world"))) != "base64" {
		t.Fatal("expected printable base64 to be detected")
	}
	if DetectFormat("abcdefghijkl") == "base64" {
		t.Fatal("expected arbitrary lowercase token to stay plain")
	}
	if got := ApplyAction("not base64 text", "base64Decode"); got != "not base64 text" {
		t.Fatalf("expected invalid base64 decode to be no-op, got %q", got)
	}
}

func TestTimestampActionAliases(t *testing.T) {
	if got := ApplyAction("1717886400", "timestampToIso"); !strings.Contains(got, "2024-06") {
		t.Fatalf("expected timestampToIso to format timestamp, got %q", got)
	}
	if got := ApplyAction("1717886400", "timestampToDate"); !strings.Contains(got, "2024-06") {
		t.Fatalf("expected timestampToDate alias to format timestamp, got %q", got)
	}
	if got := ApplyAction("2024-06-09T00:00:00Z", "dateToTimestamp"); got != "1717891200" {
		t.Fatalf("expected dateToTimestamp alias, got %q", got)
	}
}
