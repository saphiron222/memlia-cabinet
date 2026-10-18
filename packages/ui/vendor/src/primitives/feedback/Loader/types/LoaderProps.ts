import { type useRender } from '@base-ui/react/use-render';

import { type ThemeColor } from '@ui/theme/constants/MainColorNames';

export type LoaderProps = Omit<
  useRender.ComponentProps<'div'>,
  'children' | 'color'
> & {
  color?: ThemeColor;
};
