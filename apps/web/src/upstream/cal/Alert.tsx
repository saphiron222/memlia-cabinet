/** cal.diy Alert — MIT, see LICENSE. Icon and classNames ports; role/tabIndex forward for canonical error focus. */
import { cva } from "class-variance-authority";
import classNames from "./classNames";
import type { ReactNode, HTMLAttributes } from "react";
import { forwardRef } from "react";

import {
  IconInfoCircle,
  IconCircleX,
  IconAlertTriangle,
} from "@tabler/icons-react";
type IconName = "circle-x" | "triangle-alert" | "info";
function Icon({
  name,
  ...props
}: HTMLAttributes<SVGSVGElement> & { name: IconName }) {
  const Component =
    name === "circle-x"
      ? IconCircleX
      : name === "triangle-alert"
        ? IconAlertTriangle
        : IconInfoCircle;
  return <Component {...props} />;
}

export const alertStyles = cva("rounded-[10px] p-3", {
  variants: {
    severity: {
      neutral: "bg-default border-subtle border text-default",
      info: "bg-semantic-info-subtle text-semantic-info",
      warning: "bg-semantic-attention-subtle text-semantic-attention",
      error: "bg-semantic-error-subtle text-semantic-error",
    },
  },
  defaultVariants: {
    severity: "neutral",
  },
});

export interface AlertProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  title?: ReactNode;
  message?: ReactNode;
  actions?: ReactNode;
  className?: string;
  iconClassName?: string;
  severity: "warning" | "error" | "info" | "neutral";
  CustomIcon?: IconName;
  customIconColor?: string;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>((props, ref) => {
  const { severity, iconClassName, CustomIcon, customIconColor } = props;

  return (
    <div
      data-testid="alert"
      role={props.role}
      tabIndex={props.tabIndex}
      ref={ref}
      className={alertStyles({ severity, className: props.className })}
    >
      <div className="relative flex md:flex-row">
        {CustomIcon ? (
          <div className="shrink-0">
            <Icon
              name={CustomIcon}
              data-testid="custom-icon"
              aria-hidden="true"
              className={classNames(
                `h4 mr-2 w-4`,
                iconClassName,
                customIconColor ?? "text-default",
              )}
            />
          </div>
        ) : (
          <div
            className={classNames("mr-2 shrink-0", props.title ? "" : "mt-0.5")}
          >
            {severity === "error" && (
              <Icon
                name="circle-x"
                data-testid="circle-x"
                className={classNames("h4 w-4", iconClassName)}
                aria-hidden="true"
              />
            )}
            {severity === "warning" && (
              <Icon
                name="triangle-alert"
                data-testid="alert-triangle"
                className={classNames("h4 w-4", iconClassName)}
                aria-hidden="true"
              />
            )}
            {severity === "info" && (
              <Icon
                name="info"
                data-testid="info"
                className={classNames("h4 w-4", iconClassName)}
                aria-hidden="true"
              />
            )}
            {severity === "neutral" && (
              <Icon
                name="info"
                data-testid="neutral"
                className={classNames(
                  "text-default h4 w-4 fill-transparent",
                  iconClassName,
                )}
                aria-hidden="true"
              />
            )}
          </div>
        )}
        <div className="flex grow flex-col sm:flex-row">
          <div className="stack-y-1 ltr:ml-3 rtl:mr-3">
            {props.title && (
              <h3 className="text-sm font-medium leading-none">
                {props.title}
              </h3>
            )}
            {props.message && (
              <div className="text-sm leading-5">{props.message}</div>
            )}
          </div>
          {props.actions && (
            <div className="ml-auto mt-auto text-sm sm:mt-0 md:relative">
              {props.actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

Alert.displayName = "Alert";
