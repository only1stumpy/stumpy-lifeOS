import assert from "node:assert/strict";
import test from "node:test";
import { parseChangelog } from "../src/domain/changelog";
import { buildReleaseNotice, releaseNoticeKey, shouldAnnounceRelease } from "../src/domain/release";

const CHANGELOG = `# Журнал изменений

## 1.0.0-rc.3 · 2026-11-20

### Для развёртывания

- Миграция 0020 применена.

### Исправлено

- Первое исправление.
- Второе исправление.

### Изменено

- Одно изменение.

## 1.0.0-rc.2 · 2026-11-16

### Изменено

- Старая запись.
`;

test("журнал: берутся пункты для пользователя, раздел «Для развёртывания» пропускается", () => {
  const releases = parseChangelog(CHANGELOG);
  assert.deepEqual(releases.map((release) => release.version), ["1.0.0-rc.3", "1.0.0-rc.2"]);
  assert.deepEqual(releases[0].notes, ["Первое исправление.", "Второе исправление.", "Одно изменение."]);
  assert.deepEqual(releases[1].notes, ["Старая запись."]);
});

test("пуш о версии: только тем, кто принял политику и видел более раннюю версию", () => {
  const accepted = new Date("2026-11-01T00:00:00Z");
  assert.equal(shouldAnnounceRelease({ lastSeenVersion: "1.0.0-rc.2", privacyAcceptedAt: accepted }, "1.0.0-rc.3"), true);
  assert.equal(shouldAnnounceRelease({ lastSeenVersion: "1.0.0-rc.3", privacyAcceptedAt: accepted }, "1.0.0-rc.3"), false, "уже видел эту версию");
  assert.equal(shouldAnnounceRelease({ lastSeenVersion: null, privacyAcceptedAt: accepted }, "1.0.0-rc.3"), false, "новый пользователь");
  assert.equal(shouldAnnounceRelease({ lastSeenVersion: "1.0.0-rc.2", privacyAcceptedAt: null }, "1.0.0-rc.3"), false, "без согласия");
  assert.equal(shouldAnnounceRelease({ lastSeenVersion: "1.0.0-rc.9", privacyAcceptedAt: accepted }, "1.0.0"), true, "релиз новее кандидата");
});

test("текст пуша: версия, пункты и не больше восьми строк, длинный список обрезается", () => {
  const text = buildReleaseNotice({ version: "1.0.0-rc.3", notes: ["Раз.", "Два."] });
  assert.match(text, /Вышла новая версия LifeOS 1\.0\.0-rc\.3\./);
  assert.match(text, /• Раз\.\n• Два\./);
  const long = buildReleaseNotice({ version: "1.0.0", notes: Array.from({ length: 12 }, (_, index) => `Пункт ${index + 1}.`) });
  assert.equal(long.split("\n").filter((line) => line.startsWith("• ")).length, 8);
  assert.match(long, /…и ещё 4/);
  assert.ok(long.length <= 3500);
});

test("ключ рассылки начинается с release: и не стирается очисткой старых ключей", () => {
  assert.equal(releaseNoticeKey("1.0.0-rc.3"), "release:1.0.0-rc.3");
});
