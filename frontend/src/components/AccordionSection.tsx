import { useState, type ReactNode } from 'react';

interface AccordionSectionProps {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export const AccordionSection = ({
  title,
  description,
  defaultOpen = false,
  children,
}: AccordionSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/15">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((previous) => !previous)}
      >
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
        </div>
        <span className="status-pill bg-white/5 text-slate-200">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && <div className="border-t border-white/10 px-4 py-4">{children}</div>}
    </div>
  );
};
