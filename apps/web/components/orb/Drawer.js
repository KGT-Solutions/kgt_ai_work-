import { Dialog, DialogPanel, DialogBackdrop, DialogTitle } from '@headlessui/react';
import { IconClose } from './icons';

// Right-side drawer / side panel (§6 Side panel, §7). Built on Headless UI Dialog:
// focus trap, Esc/scrim close, slide-in from the right. Header (title + optional
// description + close), scrollable body, optional sticky footer.
//
// props: open, onClose, title, description, footer, children, width (px)
export default function Drawer({ open, onClose, title, description, footer, children, width = 520 }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-40">
      <DialogBackdrop transition className="fixed inset-0 bg-orb-ink/30 duration-200 ease-out data-[closed]:opacity-0" />
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <DialogPanel
          transition
          style={{ width }}
          className="flex h-full max-w-[calc(100vw-2.5rem)] flex-col bg-orb-white shadow-orb-panel duration-200 ease-out data-[closed]:translate-x-full"
        >
          <div className="flex items-start gap-4 border-b border-orb-hairline px-6 py-5">
            <div className="min-w-0 flex-1">
              <DialogTitle className="orb-card-title text-orb-ink">{title}</DialogTitle>
              {description && <p className="mt-1 orb-small text-orb-secondary">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-orb-secondary transition-colors hover:bg-orb-subtle hover:text-orb-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink"
            >
              <IconClose size={16} />
            </button>
          </div>
          <div className="orb-scrollbar flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="border-t border-orb-hairline px-6 py-4">{footer}</div>}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
