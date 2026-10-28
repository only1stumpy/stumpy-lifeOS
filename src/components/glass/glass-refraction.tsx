"use client";

import { useEffect, useRef, type RefObject } from "react";

type GlassProfile = "soft" | "thin";
type GlassShape = "rounded-rectangle" | "pill";

type GlassRefractionProps = {
  surfaceRef: RefObject<HTMLElement | null>;
  filterId: string;
  profile: GlassProfile;
  shape?: GlassShape;
  forceFallback?: boolean;
};

type DisplacementMap = { url: string; scale: number };

const MAP_CACHE_LIMIT = 12;
const SUPER_SAMPLE = 2;
const mapCache = new Map<string, DisplacementMap>();
const xlinkNamespace = "http://www.w3.org/1999/xlink";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothStep(min: number, max: number, value: number): number {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function profileCurve(value: number, profile: GlassProfile): number {
  const eased = smoothStep(0, 1, value);
  return profile === "soft" ? eased * 0.78 : Math.pow(eased, 1.45);
}

function roundedRectSdf(x: number, y: number, width: number, height: number, radius: number): number {
  const cx = x - width / 2;
  const cy = y - height / 2;
  const hx = Math.max(0, width / 2 - radius);
  const hy = Math.max(0, height / 2 - radius);
  const qx = Math.abs(cx) - hx;
  const qy = Math.abs(cy) - hy;
  const inner = Math.min(Math.max(qx, qy), 0);
  const outer = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return inner + outer - radius;
}

function createDisplacementPixels(
  width: number,
  height: number,
  radius: number,
  profile: GlassProfile,
): { data: Uint8ClampedArray; scale: number } {
  const magnify = 0.38;
  const bend = 0.02;
  const spread = 0.58;
  const bezelRatio = 0.36;
  const bezel = clamp(Math.min(width, height) * 0.5 * bezelRatio, 10, 220);
  const centerX = width / 2;
  const centerY = height / 2;
  const raw = new Float32Array(width * height * 2);
  let maximum = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const distance = roundedRectSdf(px, py, width, height, radius);
      let dx = 0;
      let dy = 0;

      if (distance > -bezel) {
        const pull = smoothStep(-bezel, 0, Math.min(distance, 0));
        const shaped = profileCurve(pull, profile);
        const ox = (px - centerX) / (width / 2);
        const oy = (py - centerY) / (height / 2);
        dx = -ox * shaped * magnify * bezel;
        dy = -oy * shaped * magnify * bezel;
        dx += Math.sin(((px / width) - 0.5) * Math.PI) * bend * bezel * shaped;
        dy += Math.sin(((py / height) - 0.5) * Math.PI) * bend * bezel * shaped;
      }

      const index = (y * width + x) * 2;
      raw[index] = dx;
      raw[index + 1] = dy;
      maximum = Math.max(maximum, Math.abs(dx), Math.abs(dy));
    }
  }

  const range = Math.max(1, maximum * spread);
  const data = new Uint8ClampedArray(width * height * 4);
  let rawIndex = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = raw[rawIndex];
      const dy = raw[rawIndex + 1];
      rawIndex += 2;
      const edgeDistance = Math.min(x, y, width - x - 1, height - y - 1);
      const edgeFactor = smoothStep(0, 3, edgeDistance);
      const pixel = (y * width + x) * 4;
      data[pixel] = Math.round(clamp((dx * edgeFactor) / range * 0.5 + 0.5, 0, 1) * 255);
      data[pixel + 1] = Math.round(clamp((dy * edgeFactor) / range * 0.5 + 0.5, 0, 1) * 255);
      data[pixel + 2] = 0;
      data[pixel + 3] = 255;
    }
  }

  return { data, scale: range * 2 };
}

function cachedMap(width: number, height: number, radius: number, profile: GlassProfile): DisplacementMap | null {
  const mapWidth = Math.max(160, Math.round(width * SUPER_SAMPLE));
  const mapHeight = Math.max(96, Math.round(height * SUPER_SAMPLE));
  const mapRadius = Math.max(4, Math.round(radius * SUPER_SAMPLE));
  const key = `v1:${mapWidth}x${mapHeight}:${mapRadius}:${profile}:${SUPER_SAMPLE}`;
  const cached = mapCache.get(key);
  if (cached) {
    mapCache.delete(key);
    mapCache.set(key, cached);
    return cached;
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = mapWidth;
    canvas.height = mapHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;

    const image = context.createImageData(mapWidth, mapHeight);
    const result = createDisplacementPixels(mapWidth, mapHeight, mapRadius, profile);
    image.data.set(result.data);
    context.putImageData(image, 0, 0);
    const map = { url: canvas.toDataURL("image/png"), scale: result.scale / SUPER_SAMPLE };
    mapCache.set(key, map);
    if (mapCache.size > MAP_CACHE_LIMIT) {
      const oldestKey = mapCache.keys().next().value;
      if (oldestKey) mapCache.delete(oldestKey);
    }
    return map;
  } catch {
    return null;
  }
}

function supportsChromiumRefraction(filterId: string): boolean {
  const userAgent = navigator.userAgent;
  const isChromium = /(?:Chrome|Chromium)\//.test(userAgent) && !/(?:CriOS|FxiOS|Firefox)\//.test(userAgent);
  const supports = window.CSS?.supports;
  return Boolean(
    isChromium &&
    supports?.("backdrop-filter", `url("#${filterId}") blur(.3px) saturate(1.12)`) &&
    supports?.("backdrop-filter", "blur(1px)")
  );
}

function applyFallback(surface: HTMLElement): void {
  surface.style.removeProperty("backdrop-filter");
  surface.style.removeProperty("-webkit-backdrop-filter");
  surface.dataset.lgRefraction = "fallback";
  delete surface.dataset.lensScale;
}

export function GlassRefraction({
  surfaceRef,
  filterId,
  profile,
  shape = "rounded-rectangle",
  forceFallback = false,
}: GlassRefractionProps) {
  const filterRef = useRef<SVGFilterElement>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    const filter = filterRef.current;
    const image = filter?.querySelector("feImage");
    const displacement = filter?.querySelector("feDisplacementMap");
    if (!surface || !filter || !image || !displacement) return;

    const reducedTransparency = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const highContrast = window.matchMedia("(prefers-contrast: more)");
    let lastShapeKey = "";
    let observer: ResizeObserver | null = null;
    const isUnsupported = () => forceFallback || reducedTransparency.matches || highContrast.matches || !supportsChromiumRefraction(filterId);

    const update = () => {
      if (isUnsupported()) {
        applyFallback(surface);
        return;
      }

      const rect = surface.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) {
        lastShapeKey = "";
        applyFallback(surface);
        return;
      }

      const borderRadius = Number.parseFloat(window.getComputedStyle(surface).borderTopLeftRadius) || 24;
      const radius = shape === "pill"
        ? rect.height / 2
        : clamp(borderRadius, 4, Math.min(rect.width, rect.height) / 2);
      const shapeKey = `${Math.round(rect.width * SUPER_SAMPLE)}:${Math.round(rect.height * SUPER_SAMPLE)}:${Math.round(radius * SUPER_SAMPLE)}:${profile}`;
      if (shapeKey === lastShapeKey) return;

      const map = cachedMap(rect.width, rect.height, radius, profile);
      if (!map) {
        lastShapeKey = "";
        applyFallback(surface);
        return;
      }

      image.setAttribute("href", map.url);
      image.setAttributeNS(xlinkNamespace, "xlink:href", map.url);
      const scale = map.scale * (profile === "thin" ? 0.65 : 0.7);
      displacement.setAttribute("scale", scale.toFixed(2));
      surface.style.setProperty("backdrop-filter", `url("#${filterId}") blur(.3px) saturate(1.12)`);
      surface.style.setProperty("-webkit-backdrop-filter", `url("#${filterId}") blur(.3px) saturate(1.12)`);
      surface.dataset.lgRefraction = "measured";
      surface.dataset.lensScale = scale.toFixed(2);
      lastShapeKey = shapeKey;
    };

    const onPreferenceChange = () => {
      lastShapeKey = "";
      update();
    };

    reducedTransparency.addEventListener("change", onPreferenceChange);
    highContrast.addEventListener("change", onPreferenceChange);
    update();

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      observer.observe(surface);
    }

    return () => {
      observer?.disconnect();
      reducedTransparency.removeEventListener("change", onPreferenceChange);
      highContrast.removeEventListener("change", onPreferenceChange);
      surface.style.removeProperty("backdrop-filter");
      surface.style.removeProperty("-webkit-backdrop-filter");
      delete surface.dataset.lgRefraction;
      delete surface.dataset.lensScale;
    };
  }, [filterId, forceFallback, profile, shape, surfaceRef]);

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", pointerEvents: "none", zIndex: -1 }}
    >
      <defs>
        <filter
          ref={filterRef}
          id={filterId}
          colorInterpolationFilters="sRGB"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
        >
          <feImage x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale="0"
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />
        </filter>
      </defs>
    </svg>
  );
}
