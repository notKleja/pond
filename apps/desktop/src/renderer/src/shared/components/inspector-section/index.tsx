import { IconChevronDown } from "@pond/icons";
import { Accordion } from "@pond/ui";
import { clsx as cn } from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import { gentleSpring } from "@/shared/lib/motion";
import styles from "./styles.module.css";

interface SectionProps {
  title: string;
  className?: string;
  defaultOpen?: boolean;
  divider?: boolean;
  action?: React.ReactNode;
  empty?: boolean;
  collapsible?: boolean;
  children: React.ReactNode;
}

export function Section({
  title,
  className,
  defaultOpen = true,
  divider = true,
  action,
  empty = false,
  collapsible = true,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const reduceMotion = useReducedMotion();

  if (empty && !action) return null;

  if (!collapsible) {
    return (
      <section
        className={cn(styles.section, className)}
        data-divider={divider ? undefined : "none"}
        aria-labelledby={`${id}-title`}
      >
        <h3 className={styles.header}>
          <span className={styles.title} id={`${id}-title`}>
            {title}
          </span>
          {action ? <span className={styles.action}>{action}</span> : null}
        </h3>
        {empty ? null : (
          <div className={styles.panel} data-static="">
            {children}
          </div>
        )}
      </section>
    );
  }

  const expanded = !empty && open;
  /** One header tree, so an open picker stays anchored when the first item appears. */
  return (
    <Accordion.Root
      className={cn(styles.section, className)}
      data-divider={divider ? undefined : "none"}
      multiple
      value={expanded ? [title] : []}
      onValueChange={(next) => {
        if (!empty) setOpen(next.includes(title));
      }}
    >
      <Accordion.Item value={title} className={styles.item}>
        <Accordion.Header className={styles.header}>
          {empty ? (
            <span className={styles.title} id={`${id}-title`}>
              {title}
            </span>
          ) : (
            <Accordion.Trigger
              className={styles.trigger}
              id={`${id}-trigger`}
              aria-controls={expanded ? `${id}-panel` : undefined}
            >
              <span className={styles.title}>{title}</span>
              <span className={styles.chevron} aria-hidden>
                <IconChevronDown size={12} />
              </span>
            </Accordion.Trigger>
          )}
          {action ? <span className={styles.action}>{action}</span> : null}
        </Accordion.Header>
        <AnimatePresence mode="wait" initial={false}>
          {expanded ? (
            <motion.div
              id={`${id}-panel`}
              role="region"
              aria-labelledby={`${id}-trigger`}
              className={styles.panel}
              initial={{ height: 0, opacity: 0, marginTop: 0 }}
              animate={{ height: "auto", opacity: 1, marginTop: 8 }}
              exit={{ height: 0, opacity: 0, marginTop: 0 }}
              transition={reduceMotion ? { duration: 0 } : gentleSpring}
            >
              {children}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Accordion.Item>
    </Accordion.Root>
  );
}
