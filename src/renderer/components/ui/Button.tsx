/**

 * Button — Vyotiq UI action affordance (`vx-btn-*`).

 */



import React from 'react';

import { cn } from '../../lib/cn.js';

import { Spinner } from './Spinner.js';



type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'accentFill' | 'link';

type Size = 'sm' | 'md';



interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {

  variant?: Variant;

  size?: Size;

  loading?: boolean;

}



const VARIANT_CLASS: Record<Variant, string> = {

  primary: 'vx-btn vx-btn-primary',

  secondary: 'vx-btn vx-btn-quiet',

  ghost: 'vx-btn vx-btn-text',

  danger: 'vx-btn vx-btn-danger',

  accent: 'vx-btn vx-btn-accent',

  accentFill: 'vx-btn vx-btn-accent-fill',

  link: 'vx-btn vx-btn-link'

};



const SIZE_CLASS: Record<Size, string> = {

  sm: 'h-6 px-2 text-meta',

  md: ''

};



const SPINNER_SIZE: Record<Size, number> = {

  sm: 12,

  md: 14

};



export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(

  { variant = 'secondary', size = 'md', className, children, loading, disabled, ...rest },

  ref

) {

  const isDisabled = disabled || loading;

  return (

    <button

      ref={ref}

      type="button"

      aria-busy={loading || undefined}

      disabled={isDisabled}

      className={cn(

        'app-no-drag',

        VARIANT_CLASS[variant],

        SIZE_CLASS[size],

        size === 'md' && variant === 'primary' && 'px-3.5 py-2',

        className

      )}

      {...rest}

    >

      {loading && <Spinner size={SPINNER_SIZE[size]} className="text-current" />}

      {children}

    </button>

  );

});

