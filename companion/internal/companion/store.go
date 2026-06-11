package companion

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const recentCanonicalDuplicateWindowMs int64 = 8000

type Store struct {
	path string
	mu   sync.Mutex
}

func NewStore(path string) *Store {
	return &Store{path: path}
}

func (store *Store) Path() string {
	return store.path
}

func (store *Store) Load() (StoreFile, error) {
	var file StoreFile
	err := store.withLock(func() error {
		var loadErr error
		file, loadErr = store.loadLocked()
		return loadErr
	})
	return file, err
}

func (store *Store) AddHistoryEntry(entry HistoryEntry, limit int) (HistoryEntry, error) {
	var savedEntry HistoryEntry
	err := store.withLock(func() error {
		file, err := store.loadLocked()
		if err != nil {
			return err
		}

		if limit <= 0 {
			limit = file.Settings.MaxItems
		}
		if limit <= 0 {
			limit = DefaultHistoryLimit
		}

		normalizedEntry, ok := normalizeHistoryEntry(entry)
		if !ok {
			return errors.New("history entry text is empty")
		}
		operationAt := historyOperationTime(normalizedEntry)
		if duplicateID := resolveRecentCanonicalDuplicate(file.History, normalizedEntry, operationAt); duplicateID != "" {
			normalizedEntry.ID = duplicateID
		}
		if shouldIgnoreUpsert(file, normalizedEntry.ID, operationAt) {
			savedEntry = normalizedEntry
			return nil
		}

		next := make([]HistoryEntry, 0, len(file.History)+1)
		inserted := normalizedEntry
		replaced := false
		for _, existing := range file.History {
			normalizedExisting, ok := normalizeHistoryEntry(existing)
			if !ok {
				continue
			}
			if normalizedExisting.ID == normalizedEntry.ID {
				inserted = mergeHistoryEntry(normalizedExisting, normalizedEntry)
				replaced = true
				continue
			}
			next = append(next, normalizedExisting)
		}
		next = append(next, inserted)

		file.Tombstones = removeHistoryTombstone(file.Tombstones, inserted.ID)
		file.History = trimHistoryEntries(sortHistory(next), limit)
		if !replaced {
			for _, item := range file.History {
				if item.ID == inserted.ID {
					savedEntry = item
					break
				}
			}
		} else {
			savedEntry = inserted
		}
		if savedEntry.ID == "" {
			savedEntry = inserted
		}

		return store.saveLocked(file)
	})
	return savedEntry, err
}

func (store *Store) ListHistory(options ListHistoryOptions) ([]HistoryEntry, error) {
	var entries []HistoryEntry
	err := store.withLock(func() error {
		file, err := store.loadLocked()
		if err != nil {
			return err
		}

		query := strings.ToLower(strings.TrimSpace(options.Query))
		entries = make([]HistoryEntry, 0, len(file.History))
		for _, entry := range sortHistory(file.History) {
			if query != "" && !historyMatches(entry, query) {
				continue
			}
			entries = append(entries, entry)
		}

		limit := historyListLimit(file.History, options.Limit, file.Settings.MaxItems)
		if len(entries) > limit {
			entries = entries[:limit]
		}
		return nil
	})
	return entries, err
}

func (store *Store) DeleteHistory(id string) (bool, error) {
	return store.DeleteHistoryAt(id, time.Now().UnixMilli())
}

func (store *Store) DeleteHistoryAt(id string, operationAt int64) (bool, error) {
	return store.DeleteHistoryResolvedAt(id, "", operationAt)
}

func (store *Store) DeleteHistoryResolved(id string, text string) (bool, error) {
	return store.DeleteHistoryResolvedAt(id, text, time.Now().UnixMilli())
}

func (store *Store) DeleteHistoryResolvedAt(id string, text string, operationAt int64) (bool, error) {
	deleted := false
	err := store.withLock(func() error {
		file, err := store.loadLocked()
		if err != nil {
			return err
		}

		operationAt = normalizeOperationAt(operationAt)
		targetID := resolveHistoryMutationID(file.History, id, text)
		if targetID == "" {
			targetID = fallbackHistoryMutationID(id, text)
		}
		if targetID == "" {
			return nil
		}
		next := make([]HistoryEntry, 0, len(file.History))
		staleDelete := false
		for _, entry := range file.History {
			if entry.ID == targetID {
				if historyOperationTime(entry) > operationAt {
					next = append(next, entry)
					staleDelete = true
					continue
				}
				deleted = true
				continue
			}
			next = append(next, entry)
		}
		if staleDelete {
			return nil
		}
		file.Tombstones = upsertHistoryTombstone(file.Tombstones, targetID, operationAt)
		if !deleted && tombstoneDeletedAt(file.Tombstones, targetID) > operationAt {
			return nil
		}
		file.History = next
		return store.saveLocked(file)
	})
	return deleted, err
}

func (store *Store) ClearHistory() (int, error) {
	return store.ClearHistoryAt(time.Now().UnixMilli())
}

func (store *Store) ClearHistoryAt(operationAt int64) (int, error) {
	cleared := 0
	err := store.withLock(func() error {
		file, err := store.loadLocked()
		if err != nil {
			return err
		}
		operationAt = normalizeOperationAt(operationAt)
		if operationAt > file.ClearedAt {
			file.ClearedAt = operationAt
		}
		next := make([]HistoryEntry, 0, len(file.History))
		for _, entry := range file.History {
			if historyOperationTime(entry) > operationAt {
				next = append(next, entry)
				continue
			}
			cleared++
		}
		file.History = next
		return store.saveLocked(file)
	})
	return cleared, err
}

func (store *Store) PinHistory(id string, pinned bool) (bool, error) {
	return store.PinHistoryAt(id, pinned, time.Now().UnixMilli())
}

func (store *Store) PinHistoryAt(id string, pinned bool, operationAt int64) (bool, error) {
	return store.PinHistoryResolvedAt(id, "", pinned, operationAt)
}

func (store *Store) PinHistoryResolved(id string, text string, pinned bool) (bool, error) {
	return store.PinHistoryResolvedAt(id, text, pinned, time.Now().UnixMilli())
}

func (store *Store) PinHistoryResolvedAt(id string, text string, pinned bool, operationAt int64) (bool, error) {
	changed := false
	err := store.withLock(func() error {
		file, err := store.loadLocked()
		if err != nil {
			return err
		}

		operationAt = normalizeOperationAt(operationAt)
		targetID := resolveHistoryMutationID(file.History, id, text)
		if targetID == "" {
			return nil
		}
		for index := range file.History {
			if file.History[index].ID == targetID {
				if file.History[index].PinUpdatedAt > operationAt || historyTombstoneBlocks(file, targetID, operationAt) {
					return nil
				}
				if file.History[index].Pinned == pinned {
					return nil
				}
				file.History[index].Pinned = pinned
				file.History[index].PinUpdatedAt = operationAt
				changed = true
				break
			}
		}
		if !changed {
			return nil
		}
		file.History = sortHistory(file.History)
		return store.saveLocked(file)
	})
	return changed, err
}

func resolveHistoryMutationID(history []HistoryEntry, id string, text string) string {
	for _, entry := range history {
		if id != "" && entry.ID == id {
			return id
		}
	}
	if strings.TrimSpace(text) == "" {
		return ""
	}
	fallbackID := HistoryID(text)
	for _, entry := range history {
		if entry.ID == fallbackID {
			return fallbackID
		}
	}
	canonicalText := canonicalHistoryText(text)
	if canonicalText != "" {
		for _, entry := range sortHistory(history) {
			if canonicalHistoryText(entry.Text) == canonicalText {
				return entry.ID
			}
		}
	}
	return ""
}

func resolveRecentCanonicalDuplicate(history []HistoryEntry, incoming HistoryEntry, operationAt int64) string {
	canonicalText := canonicalHistoryText(incoming.Text)
	if canonicalText == "" {
		return ""
	}
	var matchedID string
	var matchedAt int64
	for _, entry := range history {
		if entry.ID == incoming.ID || canonicalHistoryText(entry.Text) != canonicalText {
			continue
		}
		entryAt := historyOperationTime(entry)
		if !withinRecentDuplicateWindow(entryAt, operationAt) && !withinRecentDuplicateWindow(entry.CreatedAt, incoming.CreatedAt) {
			continue
		}
		if matchedID == "" || entryAt > matchedAt {
			matchedID = entry.ID
			matchedAt = entryAt
		}
	}
	return matchedID
}

func canonicalHistoryText(text string) string {
	return strings.ToLower(strings.Join(strings.Fields(text), " "))
}

func withinRecentDuplicateWindow(left int64, right int64) bool {
	if left <= 0 || right <= 0 {
		return false
	}
	delta := left - right
	if delta < 0 {
		delta = -delta
	}
	return delta <= recentCanonicalDuplicateWindowMs
}

func fallbackHistoryMutationID(id string, text string) string {
	if id != "" {
		return id
	}
	if strings.TrimSpace(text) == "" {
		return ""
	}
	return HistoryID(text)
}

func shouldIgnoreUpsert(file StoreFile, id string, operationAt int64) bool {
	if operationAt <= 0 {
		return false
	}
	if file.ClearedAt > 0 && operationAt <= file.ClearedAt {
		return true
	}
	return historyTombstoneBlocks(file, id, operationAt)
}

func historyTombstoneBlocks(file StoreFile, id string, operationAt int64) bool {
	return id != "" && tombstoneDeletedAt(file.Tombstones, id) >= operationAt && operationAt > 0
}

func tombstoneDeletedAt(tombstones []HistoryTombstone, id string) int64 {
	for _, tombstone := range tombstones {
		if tombstone.ID == id {
			return tombstone.DeletedAt
		}
	}
	return 0
}

func upsertHistoryTombstone(tombstones []HistoryTombstone, id string, deletedAt int64) []HistoryTombstone {
	if id == "" || deletedAt <= 0 {
		return tombstones
	}
	next := make([]HistoryTombstone, 0, len(tombstones)+1)
	replaced := false
	for _, tombstone := range normalizeTombstones(tombstones) {
		if tombstone.ID == id {
			if tombstone.DeletedAt < deletedAt {
				tombstone.DeletedAt = deletedAt
			}
			replaced = true
		}
		next = append(next, tombstone)
	}
	if !replaced {
		next = append(next, HistoryTombstone{ID: id, DeletedAt: deletedAt})
	}
	return next
}

func removeHistoryTombstone(tombstones []HistoryTombstone, id string) []HistoryTombstone {
	if id == "" {
		return normalizeTombstones(tombstones)
	}
	next := make([]HistoryTombstone, 0, len(tombstones))
	for _, tombstone := range normalizeTombstones(tombstones) {
		if tombstone.ID != id {
			next = append(next, tombstone)
		}
	}
	return next
}

func normalizeTombstones(tombstones []HistoryTombstone) []HistoryTombstone {
	latest := make(map[string]int64, len(tombstones))
	for _, tombstone := range tombstones {
		if tombstone.ID == "" || tombstone.DeletedAt <= 0 {
			continue
		}
		if latest[tombstone.ID] < tombstone.DeletedAt {
			latest[tombstone.ID] = tombstone.DeletedAt
		}
	}
	next := make([]HistoryTombstone, 0, len(latest))
	for id, deletedAt := range latest {
		next = append(next, HistoryTombstone{ID: id, DeletedAt: deletedAt})
	}
	sort.SliceStable(next, func(i, j int) bool {
		if next[i].DeletedAt != next[j].DeletedAt {
			return next[i].DeletedAt > next[j].DeletedAt
		}
		return next[i].ID < next[j].ID
	})
	return next
}

func (store *Store) GetSettings() (Settings, error) {
	var settings Settings
	err := store.withLock(func() error {
		file, err := store.loadLocked()
		if err != nil {
			return err
		}
		settings = file.Settings
		return nil
	})
	return settings, err
}

func (store *Store) UpdateSettings(patch SettingsPatch) (Settings, error) {
	var settings Settings
	err := store.withLock(func() error {
		file, err := store.loadLocked()
		if err != nil {
			return err
		}

		settings = file.Settings
		if patch.HistoryEnabled != nil {
			settings.HistoryEnabled = *patch.HistoryEnabled
		}
		if patch.MaxItems != nil {
			settings.MaxItems = clampMaxItems(*patch.MaxItems)
		}
		if patch.AutoStart != nil {
			settings.AutoStart = *patch.AutoStart
		}
		if patch.Hotkey != nil {
			settings.Hotkey = normalizeHotkey(*patch.Hotkey)
		}

		file.Settings = settings
		file.History = trimHistoryEntries(sortHistory(file.History), settings.MaxItems)
		return store.saveLocked(file)
	})
	return settings, err
}

func (store *Store) withLock(fn func() error) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	return withFileLock(store.path+".lock", fn)
}

func (store *Store) loadLocked() (StoreFile, error) {
	fileBytes, err := os.ReadFile(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return migrateStore(StoreFile{}), nil
	}
	if err != nil {
		return StoreFile{}, err
	}

	var file StoreFile
	if err := json.Unmarshal(fileBytes, &file); err != nil {
		backup, backupErr := store.loadBackupLocked()
		if backupErr == nil {
			_ = os.Rename(store.path, fmt.Sprintf("%s.corrupt-%d", store.path, time.Now().UnixMilli()))
			return backup, nil
		}
		return StoreFile{}, fmt.Errorf("%w; backup recovery failed: %v", err, backupErr)
	}
	return migrateStore(file), nil
}

func (store *Store) saveLocked(file StoreFile) error {
	if file.SchemaVersion <= 0 {
		file.SchemaVersion = StoreSchemaVersion
	}
	if file.Settings.MaxItems <= 0 {
		file.Settings.MaxItems = DefaultSettings().MaxItems
	}
	if file.Settings.Hotkey == "" {
		file.Settings.Hotkey = DefaultSettings().Hotkey
	}
	if file.History == nil {
		file.History = []HistoryEntry{}
	}
	if file.Tombstones == nil {
		file.Tombstones = []HistoryTombstone{}
	}
	file.UpdatedAt = time.Now().UnixMilli()
	if err := os.MkdirAll(filepath.Dir(store.path), 0o700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	if err := store.backupCurrentLocked(); err != nil {
		return err
	}
	return writeFileAtomic(store.path, payload, 0o600)
}

func migrateStore(file StoreFile) StoreFile {
	defaults := DefaultSettings()
	oldSchema := file.SchemaVersion
	if file.SchemaVersion <= 0 {
		file.SchemaVersion = StoreSchemaVersion
	}
	if file.Settings.MaxItems == 0 && file.Settings.Hotkey == "" && file.UpdatedAt == 0 && oldSchema <= 0 {
		file.Settings = defaults
	}
	file.Settings.MaxItems = clampMaxItems(defaultIfZero(file.Settings.MaxItems, defaults.MaxItems))
	if file.Settings.Hotkey == "" {
		file.Settings.Hotkey = defaults.Hotkey
	}
	if !file.Settings.HistoryEnabled && oldSchema <= 0 && file.UpdatedAt == 0 {
		file.Settings.HistoryEnabled = defaults.HistoryEnabled
	}
	nextHistory := make([]HistoryEntry, 0, len(file.History))
	for index := range file.History {
		if normalized, ok := normalizeHistoryEntry(file.History[index]); ok {
			nextHistory = append(nextHistory, normalized)
		}
	}
	file.Tombstones = normalizeTombstones(file.Tombstones)
	file.SchemaVersion = StoreSchemaVersion
	file.History = trimHistoryEntries(sortHistory(deduplicateHistory(nextHistory)), file.Settings.MaxItems)
	return file
}

func (store *Store) loadBackupLocked() (StoreFile, error) {
	backupBytes, err := os.ReadFile(store.path + ".bak")
	if err != nil {
		return StoreFile{}, err
	}
	var backup StoreFile
	if err := json.Unmarshal(backupBytes, &backup); err != nil {
		return StoreFile{}, err
	}
	return migrateStore(backup), nil
}

func (store *Store) backupCurrentLocked() error {
	fileBytes, err := os.ReadFile(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var current StoreFile
	if err := json.Unmarshal(fileBytes, &current); err != nil {
		return nil
	}
	return writeFileAtomic(store.path+".bak", fileBytes, 0o600)
}

func writeFileAtomic(target string, payload []byte, perm os.FileMode) error {
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tempFile, err := os.CreateTemp(dir, filepath.Base(target)+".tmp-*")
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()
	defer os.Remove(tempPath)
	if _, err := tempFile.Write(payload); err != nil {
		_ = tempFile.Close()
		return err
	}
	if err := tempFile.Chmod(perm); err != nil {
		_ = tempFile.Close()
		return err
	}
	if err := tempFile.Sync(); err != nil {
		_ = tempFile.Close()
		return err
	}
	if err := tempFile.Close(); err != nil {
		return err
	}
	return replaceFileAtomic(tempPath, target)
}

func normalizeHistoryEntry(entry HistoryEntry) (HistoryEntry, bool) {
	text := entry.Text
	if strings.TrimSpace(text) == "" {
		return HistoryEntry{}, false
	}
	text, truncated := truncateStringBytes(text, MaxStoredTextBytes)
	if entry.ID == "" {
		entry.ID = HistoryID(text)
	}
	if entry.CreatedAt <= 0 {
		entry.CreatedAt = time.Now().UnixMilli()
	}
	if entry.UpdatedAt <= 0 {
		entry.UpdatedAt = entry.CreatedAt
	}
	if entry.Pinned && entry.PinUpdatedAt <= 0 {
		entry.PinUpdatedAt = entry.UpdatedAt
	}
	entry.Text = text
	if entry.Snippet == "" {
		entry.Snippet = Snippet(entry.Text, 90)
	} else {
		entry.Snippet = Snippet(entry.Snippet, 90)
	}
	if entry.Format == "" {
		entry.Format = DetectFormat(entry.Text)
	}
	if entry.Source == "" {
		entry.Source = "web-extension"
	}
	if entry.Mode == "" {
		entry.Mode = "copy"
	}
	entry.Truncated = entry.Truncated || truncated
	return entry, true
}

func mergeHistoryEntry(existing HistoryEntry, incoming HistoryEntry) HistoryEntry {
	merged := incoming
	if historyOperationTime(existing) > historyOperationTime(incoming) {
		merged = existing
	}
	if existing.PinUpdatedAt > incoming.PinUpdatedAt {
		merged.Pinned = existing.Pinned
		merged.PinUpdatedAt = existing.PinUpdatedAt
	} else if incoming.PinUpdatedAt > existing.PinUpdatedAt {
		merged.Pinned = incoming.Pinned
		merged.PinUpdatedAt = incoming.PinUpdatedAt
	} else if existing.Pinned || incoming.Pinned {
		merged.Pinned = existing.Pinned || incoming.Pinned
		merged.PinUpdatedAt = maxInt64(existing.PinUpdatedAt, incoming.PinUpdatedAt)
	}
	if existing.CreatedAt > merged.CreatedAt {
		merged.CreatedAt = existing.CreatedAt
	}
	if incoming.CreatedAt > merged.CreatedAt {
		merged.CreatedAt = incoming.CreatedAt
	}
	if shouldKeepExistingMetadata(existing, incoming) || historyOperationTime(existing) > historyOperationTime(incoming) {
		merged.Source = existing.Source
		merged.Mode = existing.Mode
		merged.URL = existing.URL
		merged.Hostname = existing.Hostname
		merged.Title = existing.Title
		merged.SelectionBased = existing.SelectionBased
	}
	if merged.URL == "" {
		merged.URL = existing.URL
	}
	if merged.Hostname == "" {
		merged.Hostname = existing.Hostname
	}
	if merged.Title == "" {
		merged.Title = existing.Title
	}
	merged.UpdatedAt = maxInt64(existing.UpdatedAt, incoming.UpdatedAt)
	merged.Truncated = existing.Truncated || incoming.Truncated
	return merged
}

func shouldKeepExistingMetadata(existing HistoryEntry, incoming HistoryEntry) bool {
	if incoming.Source != "desktop-clipboard" {
		return false
	}
	return existing.URL != "" || existing.Hostname != "" || existing.Title != "" || existing.Source != "desktop-clipboard"
}

func trimHistoryEntries(entries []HistoryEntry, maxUnpinned int) []HistoryEntry {
	if maxUnpinned <= 0 {
		maxUnpinned = DefaultHistoryLimit
	}
	next := make([]HistoryEntry, 0, len(entries))
	unpinned := 0
	for _, entry := range sortHistory(entries) {
		if entry.Pinned {
			next = append(next, entry)
			continue
		}
		if unpinned >= maxUnpinned {
			continue
		}
		unpinned++
		next = append(next, entry)
	}
	return sortHistory(next)
}

func deduplicateHistory(entries []HistoryEntry) []HistoryEntry {
	seen := make(map[string]HistoryEntry, len(entries))
	for _, entry := range entries {
		if existing, ok := seen[entry.ID]; ok {
			seen[entry.ID] = mergeHistoryEntry(existing, entry)
			continue
		}
		seen[entry.ID] = entry
	}
	next := make([]HistoryEntry, 0, len(seen))
	for _, entry := range seen {
		next = append(next, entry)
	}
	return next
}

func truncateStringBytes(text string, maxBytes int) (string, bool) {
	if maxBytes <= 0 || len(text) <= maxBytes {
		return text, false
	}
	last := 0
	for index := range text {
		if index > maxBytes {
			break
		}
		last = index
	}
	if last <= 0 {
		return text[:maxBytes], true
	}
	return text[:last], true
}

func sortHistory(entries []HistoryEntry) []HistoryEntry {
	next := append([]HistoryEntry(nil), entries...)
	sort.SliceStable(next, func(i, j int) bool {
		if next[i].Pinned != next[j].Pinned {
			return next[i].Pinned
		}
		return next[i].CreatedAt > next[j].CreatedAt
	})
	return next
}

func historyMatches(entry HistoryEntry, query string) bool {
	haystack := strings.ToLower(strings.Join([]string{
		entry.Text,
		entry.Snippet,
		entry.Format,
		entry.Source,
		entry.URL,
		entry.Hostname,
		entry.Title,
	}, " "))
	return strings.Contains(haystack, query)
}

func historyListLimit(entries []HistoryEntry, requested int, maxUnpinned int) int {
	if maxUnpinned <= 0 {
		maxUnpinned = DefaultHistoryLimit
	}
	pinned := 0
	for _, entry := range entries {
		if entry.Pinned {
			pinned++
		}
	}
	defaultLimit := pinned + maxUnpinned
	if requested <= 0 || requested > defaultLimit {
		return defaultLimit
	}
	return requested
}

func historyOperationTime(entry HistoryEntry) int64 {
	if entry.UpdatedAt > 0 {
		return entry.UpdatedAt
	}
	return entry.CreatedAt
}

func normalizeOperationAt(operationAt int64) int64 {
	if operationAt > 0 {
		return operationAt
	}
	return time.Now().UnixMilli()
}

func clampMaxItems(value int) int {
	if value < 1 {
		return 1
	}
	if value > MaxHistoryLimit {
		return MaxHistoryLimit
	}
	return value
}

func defaultIfZero(value int, fallback int) int {
	if value == 0 {
		return fallback
	}
	return value
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func normalizeHotkey(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return DefaultSettings().Hotkey
	}
	return trimmed
}

func HistoryID(text string) string {
	sum := sha256.Sum256([]byte(text))
	return fmt.Sprintf("%x", sum[:12])
}

func Snippet(text string, limit int) string {
	collapsed := strings.Join(strings.Fields(text), " ")
	runes := []rune(collapsed)
	if len(runes) <= limit {
		return collapsed
	}
	if limit < 4 {
		limit = 4
	}
	return string(runes[:limit-3]) + "..."
}
