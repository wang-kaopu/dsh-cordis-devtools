import { useEffect } from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'

export function Button({ icon, children, ...rest }: {
  variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
  size?: 'md' | 'sm'
  icon?: ReactNode
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest}>{icon}{children}</button>
}

export function Input({ icon, ...rest }: {
  icon?: ReactNode
} & InputHTMLAttributes<HTMLInputElement>) {
  return <span>{icon}<input {...rest} /></span>
}

export function Pill({ active = false, children, onClick, ...rest }: {
  active?: boolean
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  if (onClick === undefined) return <span>{children}</span>
  return (
    <button type="button" aria-pressed={active} onClick={onClick} {...rest}>
      {children}
    </button>
  )
}

export function Tooltip({ children }: { children: ReactElement }) {
  return children
}

export function DisclosureRow({
  title,
  open,
  expandable,
  onToggle,
  collapsedContent,
  children,
}: {
  icon: ReactNode
  title: string
  open: boolean
  expandable: boolean
  onToggle: () => void
  expandOnRowClick?: boolean
  previewChevron?: boolean
  keepContentWhenOpen?: boolean
  collapsedContent?: ReactNode
  children?: ReactNode
  className?: string
  rowClassName?: string
  leadingClassName?: string
  chevronClassName?: string
  titleClassName?: string
}) {
  return (
    <div data-open={open || undefined}>
      <button
        type="button"
        data-disclosure-row
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={onToggle}
      >
        <span>{title}</span>
        {collapsedContent}
      </button>
      {open && children}
    </div>
  )
}

function Icon() {
  return <span aria-hidden />
}

export const IconCloseOutline16 = Icon
export const IconCordisPluginOutline14 = Icon
export const IconRefreshOutline16 = Icon
export const IconSearchOutline16 = Icon

export function useDismissOnOutsidePointer(
  root: RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: Event): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [root, open, setOpen])
}
