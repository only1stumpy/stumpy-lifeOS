# LifeOS — промо-ролик (Remotion)

Вертикальный ролик 1080×1920, 30 fps, 52 с для Telegram-канала и Reels/Shorts.

## Запуск

```bash
npm install
npm run audio      # пересобрать public/audio/sfx.wav (клики, тапы)
npm run preview    # Remotion Studio в браузере
npm run render     # out/lifeos-promo.mp4 (H.264, CRF 18, yuv420p)
npm run poster     # out/poster.png
scripts/stills.sh 150 900 1400   # контрольные кадры в out/stills/
```

Рендер использует системный Chrome (`/usr/bin/google-chrome`, см. `remotion.config.ts`), потому что скачивание собственного headless-браузера Remotion в этой сети не проходит. Другой путь: `REMOTION_CHROME=/path/to/chrome npm run render`.

Для `+faststart` после рендера:

```bash
ffmpeg -i out/lifeos-promo.mp4 -c copy -movflags +faststart out/lifeos-promo.fs.mp4 && mv out/lifeos-promo.fs.mp4 out/lifeos-promo.mp4
```

## Где править

- `src/config.ts` — все подписи, хук, финальные строки, CTA, тайминги сцен, флаг и громкость звука (`audio.enabled`), демо-данные.
- `src/tokens.ts` — цвета, шрифты, радиусы, пружины и easing.
- `src/scenes.tsx` — внутренние тайминги сцен (тапы, связки чат → приложение, камера).
- `src/app.tsx` — экраны Mini App; `src/chat.tsx` — чат.

Если меняешь тайминги тапов, поправь и `scripts/make-audio.mjs`, затем `npm run audio`.

Все числа, блюда и суммы демонстрационные. Шрифты Medeo (OFL 1.1, `public/fonts/OFL.txt`).
