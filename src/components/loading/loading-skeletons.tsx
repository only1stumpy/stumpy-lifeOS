import type { CSSProperties } from "react";
import styles from "./loading-skeletons.module.css";

type LifeOSBootSkeletonProps = {
  fullscreen?: boolean;
  safeAreaTop?: number;
  contentSafeAreaTop?: number;
};

export function LifeOSBootSkeleton({ fullscreen = false, safeAreaTop = 0, contentSafeAreaTop = 0 }: LifeOSBootSkeletonProps) {
  const safeAreaStyle = {
    "--lifeos-telegram-safe-area-top": `${Math.max(0, safeAreaTop)}px`,
    "--lifeos-telegram-content-safe-area-top": `${Math.max(0, contentSafeAreaTop)}px`,
  } as CSSProperties;

  return (
    <div className={`${styles.boot} ${fullscreen ? styles.fullscreen : ""}`} style={safeAreaStyle} aria-hidden="true">
      <div className={styles.bootContent}>
        <header className={styles.bootHeader}>
          <span className={`${styles.block} ${styles.brandTitle}`} />
          <span className={`${styles.block} ${styles.dateChip}`} />
        </header>

        <div className={styles.pageHeading}>
          <span className={`${styles.block} ${styles.pageTitle}`} />
        </div>

        <section className={styles.surface}>
          <div className={styles.todaySection}>
            <div className={styles.cardHeading}>
              <span className={`${styles.block} ${styles.sectionLabel}`} />
              <span className={`${styles.block} ${styles.sectionLink}`} />
            </div>
            <div className={styles.bigRow}>
              <span className={`${styles.block} ${styles.bigNumber}`} />
              <span className={`${styles.block} ${styles.bigUnit}`} />
            </div>
            <div className={styles.progressTrack}><span className={styles.progressFill} /></div>
            {[0, 1, 2].map((item) => (
              <div className={styles.macroRow} key={item}>
                <span className={`${styles.block} ${styles.macroMark}`} />
                <span className={styles.macroBar} />
                <span className={`${styles.block} ${styles.macroValue}`} />
              </div>
            ))}
            <div className={styles.footRow}>
              <span className={`${styles.block} ${styles.footLeft}`} />
              <span className={`${styles.block} ${styles.footRight}`} />
            </div>
            <span className={`${styles.block} ${styles.ghostAction}`} />
          </div>

          <div className={styles.todaySection}>
            <div className={styles.cardHeading}>
              <span className={`${styles.block} ${styles.sectionLabel}`} />
              <span className={`${styles.block} ${styles.sectionLink}`} />
            </div>
            <div className={styles.financeGrid}>
              <div className={styles.financeCell}>
                <span className={`${styles.block} ${styles.statLabel}`} />
                <span className={`${styles.block} ${styles.statLabel}`} />
                <span className={`${styles.block} ${styles.moneyValue}`} />
              </div>
              <div className={styles.financeCell}>
                <span className={`${styles.block} ${styles.statLabel}`} />
                <span className={`${styles.block} ${styles.moneyValue}`} />
              </div>
            </div>
            <span className={`${styles.block} ${styles.ghostAction}`} />
          </div>
          <div className={styles.todaySection}>
            <div className={styles.cardHeading}>
              <span className={`${styles.block} ${styles.sectionLabel}`} />
              <span className={`${styles.block} ${styles.sectionLink}`} />
            </div>
            <span className={`${styles.block} ${styles.footLeft}`} />
          </div>
        </section>
      </div>

      <nav className={styles.dock}>
        <span className={styles.dockItem}><span className={`${styles.block} ${styles.dockIcon}`} /></span>
        <span className={styles.dockItem}><span className={`${styles.block} ${styles.dockIcon}`} /></span>
        <span className={styles.dockItem}><span className={`${styles.block} ${styles.dockIcon}`} /></span>
        <span className={styles.dockItem}><span className={`${styles.block} ${styles.dockIcon}`} /></span>
        <span className={styles.dockItem}><span className={`${styles.block} ${styles.dockIcon}`} /></span>
      </nav>
    </div>
  );
}

/** Mirrors the AI providers page: intro text, the limits button and one row per provider. */
export function ProviderProfilesSkeleton() {
  return (
    <div className={styles.profileList} aria-hidden="true">
      <div className={styles.introLines}>
        <span className={`${styles.block} ${styles.introLine}`} />
        <span className={`${styles.block} ${styles.introLine}`} />
        <span className={`${styles.block} ${styles.introLineShort}`} />
      </div>
      <span className={`${styles.block} ${styles.pillButton}`} />
      {[0, 1, 2, 3].map((item) => (
        <div className={styles.providerRow} key={item}>
          <span className={`${styles.block} ${styles.providerLogo}`} />
          <div className={styles.rowCopy}>
            <span className={`${styles.block} ${styles.providerName}`} />
            <span className={`${styles.block} ${styles.providerMeta}`} />
          </div>
          <span className={`${styles.block} ${styles.providerStatus}`} />
        </div>
      ))}
    </div>
  );
}

export function AiQuotasSkeleton() {
  return (
    <div className={styles.quotaList} aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div className={styles.quotaRow} key={item}>
          <div className={styles.quotaHeading}>
            <span className={`${styles.block} ${styles.quotaName}`} />
            <span className={`${styles.block} ${styles.quotaWindow}`} />
          </div>
          <div className={styles.quotaValues}>
            <span className={`${styles.block} ${styles.quotaValue}`} />
            <span className={`${styles.block} ${styles.quotaLimit}`} />
          </div>
          <div className={styles.quotaTrack}><span className={styles.quotaFill} /></div>
          <span className={`${styles.block} ${styles.quotaRemaining}`} />
        </div>
      ))}
    </div>
  );
}

/** Calm loader for a device that has not opened the dashboard yet: no layout that may not match what comes next. */
export function NeutralBootLoader() {
  return (
    <div className={styles.neutral} aria-hidden="true">
      <span className={styles.neutralMark}>LifeOS</span>
      <span className={styles.neutralBar} />
    </div>
  );
}
