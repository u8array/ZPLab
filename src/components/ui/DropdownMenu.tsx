import { Menu, MenuButton, MenuItem, MenuItems, MenuSeparator } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/16/solid';
import type { ComponentType, CSSProperties, SVGProps } from 'react';

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>;

// ── Public API ────────────────────────────────────────────────────────────────

interface MenuItemProps {
  onClick?: () => void;
  disabled?: boolean;
  shortcut?: string;
  icon?: HeroIcon;
  children: React.ReactNode;
}

interface MenuProps {
  label: React.ReactNode;
  children: React.ReactNode;
  maxHeight?: string;
  /** Accessible name for the trigger; required when `label` is icon-only. */
  ariaLabel?: string;
}

export const menuPanelCls = 'z-50 min-w-47.5 bg-surface border border-border rounded-lg shadow-2xl overflow-y-auto [--anchor-gap:4px] focus:outline-none';

export const menuTriggerCls =
  'flex items-center rounded font-mono transition-colors text-muted hover:text-text hover:bg-surface-2 data-[open]:text-accent data-[open]:bg-accent-dim';

// ── Components ────────────────────────────────────────────────────────────────

export function DropdownSeparator() {
  return <MenuSeparator className="my-1 border-t border-border" />;
}

export function DropdownItem({ onClick, disabled, shortcut, icon: Icon, children }: MenuItemProps) {
  return (
    <MenuItem disabled={disabled}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono text-text data-[focus]:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
      >
        {Icon && <Icon className="w-3.5 h-3.5 text-muted shrink-0" />}
        <span className="flex-1">{children}</span>
        {shortcut && <span className="text-muted text-[10px]">{shortcut}</span>}
      </button>
    </MenuItem>
  );
}

export function DropdownMenu({ label, children, maxHeight, ariaLabel }: MenuProps) {
  // The anchor sets the panel's max-height, so the cap goes through --anchor-max-height.
  const style = maxHeight ? ({ '--anchor-max-height': maxHeight } as CSSProperties) : undefined;
  return (
    <Menu>
      <MenuButton aria-label={ariaLabel} className={`${menuTriggerCls} gap-1 px-2.5 py-1 text-xs`}>
        {({ open }) => (
          <>
            {label}
            <ChevronDownIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </MenuButton>
      {/* Anchored in a portal, so an ancestor that clips its overflow cannot cut the panel off. */}
      <MenuItems anchor="bottom end" modal={false} className={`${menuPanelCls} p-1`} style={style}>
        {children}
      </MenuItems>
    </Menu>
  );
}
