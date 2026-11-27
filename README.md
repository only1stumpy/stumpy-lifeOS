# Набор для промо-роликов LifeOS

Орфан-ветка без истории основного кода: всё, что нужно, чтобы делать вертикальные ролики LifeOS на Remotion.

- `skill/lifeos-promo/` — скилл Claude Code. Положить в `~/.claude/skills/lifeos-promo/`.
- `memory/promo-video-caption.md` — правило памяти: к каждому ролику сразу давать описание для ТикТока. Положить в каталог памяти проекта и добавить строку в `MEMORY.md`.
- `project/lifeos-promo/` — проект Remotion. Положить в `~/Projects/lifeos-promo/`, затем `npm install` и `npm run audio` (звуки в `public/audio/` не хранятся, они генерируются).

Готовые ролики и `node_modules` в ветку не входят.
