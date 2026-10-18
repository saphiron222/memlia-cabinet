import { IconCheck, IconMinus } from '@tabler/icons-react';

import styles from '../Checkbox.module.scss';
import { type CheckboxProps } from '../types/CheckboxProps';
import { CheckboxIndicator } from './CheckboxIndicator';
import { CheckboxRoot } from './CheckboxRoot';

export const CheckboxComponent = ({ children, ...props }: CheckboxProps) => (
  <CheckboxRoot {...props}>
    <CheckboxIndicator>
      <IconCheck className={styles.check} aria-hidden />
      <IconMinus className={styles.minus} aria-hidden />
    </CheckboxIndicator>
    {children}
  </CheckboxRoot>
);
