package companion

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	return NewService(Paths{
		DataDir:   t.TempDir(),
		StorePath: filepath.Join(t.TempDir(), "history.json"),
	})
}

func TestRecordListPinDeleteHistory(t *testing.T) {
	service := newTestService(t)

	result, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:     "{\"ok\":true}",
		Source:   "web-extension",
		Hostname: "example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Stored || result.ID == "" {
		t.Fatalf("expected stored result with id, got %#v", result)
	}

	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0].Format != "json" {
		t.Fatalf("expected one json history entry, got %#v", history)
	}

	changed, err := service.PinHistory(result.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected pin to change entry")
	}

	deleted, err := service.DeleteHistory(result.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !deleted {
		t.Fatal("expected delete to remove entry")
	}
}

func TestRecordClipboardEventPreservesWhitespaceText(t *testing.T) {
	service := newTestService(t)
	text := "  {\"ok\":true}\n"
	result, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:   text,
		Source: "desktop-clipboard",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Stored {
		t.Fatalf("expected stored result, got %#v", result)
	}

	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 {
		t.Fatalf("expected one history entry, got %#v", history)
	}
	if history[0].Text != text {
		t.Fatalf("expected exact text to be preserved, got %q", history[0].Text)
	}
	if history[0].Format != "json" {
		t.Fatalf("expected whitespace-wrapped JSON to be detected, got %#v", history[0])
	}
}

func TestSettingsPatchDisablesHistory(t *testing.T) {
	service := newTestService(t)
	disabled := false
	maxItems := 3
	settings, err := service.UpdateSettings(SettingsPatch{
		HistoryEnabled: &disabled,
		MaxItems:       &maxItems,
	})
	if err != nil {
		t.Fatal(err)
	}
	if settings.HistoryEnabled || settings.MaxItems != 3 {
		t.Fatalf("unexpected settings: %#v", settings)
	}

	result, err := service.RecordClipboardEvent(ClipboardEvent{Text: "ignored"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Stored || result.Reason != "history-disabled" {
		t.Fatalf("expected disabled history result, got %#v", result)
	}
}

func TestHandleEnvelopeRoutesHistoryPin(t *testing.T) {
	service := newTestService(t)
	record, err := service.RecordClipboardEvent(ClipboardEvent{Text: "pin me"})
	if err != nil {
		t.Fatal(err)
	}

	payload, _ := json.Marshal(map[string]any{"id": record.ID, "pinned": true})
	response := HandleEnvelope(Envelope{
		ID:      "1",
		Version: ProtocolVersion,
		Type:    "HISTORY_PIN",
		Payload: payload,
	}, service)
	if !response.OK {
		t.Fatalf("expected ok response: %#v", response)
	}
}

func TestAddHistoryReturnsUpdatedPinnedEntry(t *testing.T) {
	service := newTestService(t)
	first, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:      "shared text",
		Source:    "web-extension",
		Hostname:  "example.com",
		CreatedAt: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	if changed, err := service.PinHistory(first.ID, true); err != nil || !changed {
		t.Fatalf("expected pin to change entry, changed=%v err=%v", changed, err)
	}

	second, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:      "shared text",
		Source:    "desktop-clipboard",
		CreatedAt: 200,
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("expected deduped id %q, got %q", first.ID, second.ID)
	}

	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 {
		t.Fatalf("expected one history item, got %#v", history)
	}
	if !history[0].Pinned {
		t.Fatalf("expected pinned status to survive dedup: %#v", history[0])
	}
	if history[0].Hostname != "example.com" || history[0].Source != "web-extension" {
		t.Fatalf("expected richer web metadata to survive desktop merge: %#v", history[0])
	}
}

func TestRecentCanonicalCopyFromWebAndClipboardDeduplicates(t *testing.T) {
	service := newTestService(t)
	web, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "11 THG 6, 2026 Yêu cầu hoàn tiền (1 mục)",
		Source:      "web-extension",
		Hostname:    "reportaproblem.apple.com",
		CreatedAt:   1000,
		OperationAt: 1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	desktop, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "11 thg 6, 2026 Yêu cầu hoàn tiền (1 mục)",
		Source:      "desktop-clipboard",
		CreatedAt:   2200,
		OperationAt: 2200,
	})
	if err != nil {
		t.Fatal(err)
	}
	if desktop.ID != web.ID {
		t.Fatalf("expected recent canonical duplicate to reuse id %q, got %q", web.ID, desktop.ID)
	}

	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 {
		t.Fatalf("expected one deduped history item, got %#v", history)
	}
	if history[0].Hostname != "reportaproblem.apple.com" {
		t.Fatalf("expected web metadata to survive desktop watcher merge, got %#v", history[0])
	}

	deleted, err := service.DeleteHistoryResolved("extension-local-id", "11 thg 6, 2026 yêu cầu hoàn tiền (1 mục)")
	if err != nil {
		t.Fatal(err)
	}
	if !deleted {
		t.Fatal("expected canonical text fallback to resolve deduped item")
	}
}

func TestCanonicalCopyDedupKeepsDistantCopiesSeparate(t *testing.T) {
	service := newTestService(t)
	if _, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "Case Sensitive Label",
		Source:      "web-extension",
		CreatedAt:   1000,
		OperationAt: 1000,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "case sensitive label",
		Source:      "desktop-clipboard",
		CreatedAt:   60000,
		OperationAt: 60000,
	}); err != nil {
		t.Fatal(err)
	}
	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 {
		t.Fatalf("expected distant canonical copies to remain separate, got %#v", history)
	}
}

func TestPinnedHistoryExemptFromMaxItems(t *testing.T) {
	service := newTestService(t)
	maxItems := 1
	if _, err := service.UpdateSettings(SettingsPatch{MaxItems: &maxItems}); err != nil {
		t.Fatal(err)
	}

	pinned, err := service.RecordClipboardEvent(ClipboardEvent{Text: "pinned", CreatedAt: 100})
	if err != nil {
		t.Fatal(err)
	}
	if changed, err := service.PinHistory(pinned.ID, true); err != nil || !changed {
		t.Fatalf("expected pin to change entry, changed=%v err=%v", changed, err)
	}
	if _, err := service.RecordClipboardEvent(ClipboardEvent{Text: "old unpinned", CreatedAt: 200}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RecordClipboardEvent(ClipboardEvent{Text: "new unpinned", CreatedAt: 300}); err != nil {
		t.Fatal(err)
	}

	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 {
		t.Fatalf("expected pinned plus latest unpinned item, got %#v", history)
	}
	if !history[0].Pinned || history[0].Text != "pinned" {
		t.Fatalf("expected pinned item to remain first, got %#v", history)
	}
	if history[1].Text != "new unpinned" {
		t.Fatalf("expected latest unpinned item to remain, got %#v", history[1])
	}
}

func TestPinHistoryNoopDoesNotReportChanged(t *testing.T) {
	service := newTestService(t)
	record, err := service.RecordClipboardEvent(ClipboardEvent{Text: "pin noop"})
	if err != nil {
		t.Fatal(err)
	}
	if changed, err := service.PinHistory(record.ID, true); err != nil || !changed {
		t.Fatalf("expected first pin to change, changed=%v err=%v", changed, err)
	}
	if changed, err := service.PinHistory(record.ID, true); err != nil || changed {
		t.Fatalf("expected duplicate pin to be no-op, changed=%v err=%v", changed, err)
	}
}

func TestHistoryMutationsResolveExtensionLocalIDByText(t *testing.T) {
	service := newTestService(t)
	record, err := service.RecordClipboardEvent(ClipboardEvent{Text: "shared identity"})
	if err != nil {
		t.Fatal(err)
	}

	changed, err := service.PinHistoryResolved("extension-local-id", "shared identity", true)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected text fallback to resolve pin target")
	}

	deleted, err := service.DeleteHistoryResolved("another-local-id", "shared identity")
	if err != nil {
		t.Fatal(err)
	}
	if !deleted {
		t.Fatal("expected text fallback to resolve delete target")
	}

	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 0 {
		t.Fatalf("expected resolved entry %q to be deleted, got %#v", record.ID, history)
	}
}

func TestHistoryConflictOrderingPreventsStaleDeleteAndPin(t *testing.T) {
	service := newTestService(t)
	record, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "conflict item",
		CreatedAt:   100,
		OperationAt: 200,
	})
	if err != nil {
		t.Fatal(err)
	}

	deleted, err := service.DeleteHistoryResolvedAt(record.ID, "conflict item", 150)
	if err != nil {
		t.Fatal(err)
	}
	if deleted {
		t.Fatal("expected stale delete to be ignored")
	}

	if changed, err := service.PinHistoryResolvedAt(record.ID, "conflict item", true, 250); err != nil || !changed {
		t.Fatalf("expected newer pin to apply, changed=%v err=%v", changed, err)
	}
	if changed, err := service.PinHistoryResolvedAt(record.ID, "conflict item", false, 240); err != nil || changed {
		t.Fatalf("expected older unpin to be ignored, changed=%v err=%v", changed, err)
	}

	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || !history[0].Pinned {
		t.Fatalf("expected stale mutations to preserve pinned item, got %#v", history)
	}
}

func TestHistoryTombstonePreventsStaleResurrection(t *testing.T) {
	service := newTestService(t)
	record, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "deleted item",
		CreatedAt:   100,
		OperationAt: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	if deleted, err := service.DeleteHistoryResolvedAt(record.ID, "deleted item", 200); err != nil || !deleted {
		t.Fatalf("expected delete to apply, deleted=%v err=%v", deleted, err)
	}

	if _, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "deleted item",
		CreatedAt:   150,
		OperationAt: 150,
	}); err != nil {
		t.Fatal(err)
	}
	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 0 {
		t.Fatalf("expected stale upsert to remain deleted, got %#v", history)
	}

	if _, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "deleted item",
		CreatedAt:   250,
		OperationAt: 250,
	}); err != nil {
		t.Fatal(err)
	}
	history, err = service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0].Text != "deleted item" {
		t.Fatalf("expected newer upsert to recreate item, got %#v", history)
	}
}

func TestClearHistoryHonorsOperationOrdering(t *testing.T) {
	service := newTestService(t)
	if _, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "old before clear",
		CreatedAt:   100,
		OperationAt: 100,
	}); err != nil {
		t.Fatal(err)
	}
	cleared, err := service.ClearHistoryAt(200)
	if err != nil {
		t.Fatal(err)
	}
	if cleared != 1 {
		t.Fatalf("expected one item cleared, got %d", cleared)
	}

	if _, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "old before clear",
		CreatedAt:   150,
		OperationAt: 150,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RecordClipboardEvent(ClipboardEvent{
		Text:        "new after clear",
		CreatedAt:   250,
		OperationAt: 250,
	}); err != nil {
		t.Fatal(err)
	}
	cleared, err = service.ClearHistoryAt(225)
	if err != nil {
		t.Fatal(err)
	}
	if cleared != 0 {
		t.Fatalf("expected older clear to preserve newer item, got %d cleared", cleared)
	}

	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0].Text != "new after clear" {
		t.Fatalf("expected clear to block stale resurrection only, got %#v", history)
	}
}

func TestStoreMigratesV2HistoryTimestamps(t *testing.T) {
	root := t.TempDir()
	storePath := filepath.Join(root, "history.json")
	payload := []byte(`{
  "schemaVersion": 2,
  "updatedAt": 10,
  "history": [{
    "id": "",
    "text": "migrated",
    "snippet": "",
    "format": "",
    "source": "web-extension",
    "mode": "copy",
    "createdAt": 123,
    "pinned": true
  }],
  "settings": {
    "historyEnabled": true,
    "maxItems": 500,
    "autoStart": false,
    "hotkey": "Ctrl+Shift+Space"
  }
}`)
	if err := os.WriteFile(storePath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewStore(storePath)
	file, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if file.SchemaVersion != StoreSchemaVersion {
		t.Fatalf("expected schema %d, got %d", StoreSchemaVersion, file.SchemaVersion)
	}
	if len(file.History) != 1 || file.History[0].UpdatedAt != 123 || file.History[0].PinUpdatedAt != 123 {
		t.Fatalf("expected migrated timestamps, got %#v", file.History)
	}
}

func TestClearHistoryPersistsEmptyArray(t *testing.T) {
	service := newTestService(t)
	if _, err := service.RecordClipboardEvent(ClipboardEvent{Text: "clear me"}); err != nil {
		t.Fatal(err)
	}
	cleared, err := service.ClearHistory()
	if err != nil {
		t.Fatal(err)
	}
	if cleared != 1 {
		t.Fatalf("expected one cleared item, got %d", cleared)
	}

	var raw map[string]json.RawMessage
	bytes, err := os.ReadFile(service.StorePath())
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(bytes, &raw); err != nil {
		t.Fatal(err)
	}
	if string(raw["history"]) != "[]" {
		t.Fatalf("expected history to serialize as [], got %s", raw["history"])
	}
}

func TestStoreRecoversFromBackupWhenPrimaryIsCorrupt(t *testing.T) {
	service := newTestService(t)
	record, err := service.RecordClipboardEvent(ClipboardEvent{Text: "backup item"})
	if err != nil {
		t.Fatal(err)
	}
	backupBytes, err := os.ReadFile(service.StorePath())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(service.StorePath()+".bak", backupBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(service.StorePath(), []byte("{not-json"), 0o600); err != nil {
		t.Fatal(err)
	}

	history, err := service.ListHistory(ListHistoryOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0].ID != record.ID {
		t.Fatalf("expected backup history to load, got %#v", history)
	}
	matches, err := filepath.Glob(service.StorePath() + ".corrupt-*")
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) == 0 {
		t.Fatal("expected corrupt primary file to be quarantined")
	}
}

func TestStoreFileLockPreservesConcurrentWriters(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("cross-process file lock is Windows-only in the MVP")
	}
	root := t.TempDir()
	storePath := filepath.Join(root, "history.json")
	storeA := NewStore(storePath)
	storeB := NewStore(storePath)

	const writers = 20
	var wait sync.WaitGroup
	errs := make(chan error, writers)
	for index := 0; index < writers; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			store := storeA
			if index%2 == 0 {
				store = storeB
			}
			_, err := store.AddHistoryEntry(HistoryEntry{
				Text:      "item " + string(rune('A'+index)),
				CreatedAt: int64(index + 1),
			}, 100)
			errs <- err
		}(index)
	}
	wait.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}

	history, err := storeA.ListHistory(ListHistoryOptions{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != writers {
		t.Fatalf("expected %d entries after concurrent writes, got %d: %#v", writers, len(history), history)
	}
}
