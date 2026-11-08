import { useId, type ComponentProps } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export function NativeSelect({
  className,
  ...props
}: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30',
        className,
      )}
      {...props}
    />
  )
}

export function SelectField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & ComponentProps<'select'>) {
  const id = useId()
  const hintId = useId()
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        aria-describedby={hint ? hintId : undefined}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
