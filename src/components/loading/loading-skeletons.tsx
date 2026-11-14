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

        <section className={styles.overviewCard}>
          <div className={styles.cardHeading}>
            <span className={`${styles.block} ${styles.sectionLabel}`} />
            <span className={`${styles.block} ${styles.smallBadge}`} />
          </div>
          <span className={`${styles.block} ${styles.overviewValue}`} />
          <div className={styles.statGrid}>
            <div className={styles.stat}>
              <span className={`${styles.block} ${styles.statLabel}`} />
              <span className={`${styles.block} ${styles.statValue}`} />
            </div>
            <div className={styles.stat}>
              <span className={`${styles.block} ${styles.statLabel}`} />
              <span className={`${styles.block} ${styles.statValue}`} />
            </div>
            <div className={styles.stat}>
              <span className={`${styles.block} ${styles.statLabel}`} />
              <span className={`${styles.block} ${styles.statValue}`} />
            </div>
          </div>
          <div className={styles.progressTrack}>
            <span className={styles.progressFill} />
          </div>
        </section>

        <section className={styles.secondaryCard}>
          <div className={styles.cardHeading}>
            <span className={`${styles.block} ${styles.secondaryTitle}`} />
            <span className={`${styles.block} ${styles.smallBadge}`} />
          </div>
          <div className={styles.secondaryRow}>
            <span className={`${styles.block} ${styles.rowMark}`} />
            <div className={styles.rowCopy}>
              <span className={`${styles.block} ${styles.rowTitle}`} />
              <span className={`${styles.block} ${styles.rowSubtitle}`} />
            </div>
            <span className={`${styles.block} ${styles.rowValue}`} />
          </div>
          <div className={styles.secondaryRow}>
            <span className={`${styles.block} ${styles.rowMark}`} />
            <div className={styles.rowCopy}>
              <span className={`${styles.block} ${styles.rowTitle}`} />
              <span className={`${styles.block} ${styles.rowSubtitle}`} />
            </div>
            <span className={`${styles.block} ${styles.rowValue}`} />
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

export function ProviderProfilesSkeleton() {
  return (
    <div className={styles.profileList} aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div className={styles.profileCard} key={item}>
          <div className={styles.profileHeader}>
            <span className={`${styles.block} ${styles.profileName}`} />
            <span className={`${styles.block} ${styles.profileStatus}`} />
          </div>
          <span className={`${styles.block} ${styles.profileModel}`} />
          <span className={`${styles.block} ${styles.profileEndpoint}`} />
          <span className={`${styles.block} ${styles.profileKey}`} />
          <div className={styles.profileActions}>
            <span className={`${styles.block} ${styles.profileAction}`} />
            <span className={`${styles.block} ${styles.profileActionShort}`} />
          </div>
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
