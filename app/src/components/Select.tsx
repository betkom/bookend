import type { SelectHTMLAttributes } from 'react';
import { ChevronDownIcon } from '@radix-ui/react-icons';

/** A native select with consistent space around its decorative chevron. */
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="select-control">
    <select {...props} />
    <ChevronDownIcon className="select-chevron" aria-hidden="true" />
  </span>;
}
