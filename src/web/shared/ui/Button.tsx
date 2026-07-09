import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ComponentProps } from "react";
import { buttonClassName } from "./styles";

type ButtonProps = ComponentProps<typeof ButtonPrimitive> & {
	variant?: "primary" | "secondary" | "danger";
};

const variants = {
	primary: "font-bold",
	secondary: "",
	danger:
		"border-red-700 text-red-700 hover:not-data-disabled:bg-red-50 active:not-data-disabled:bg-red-100 focus-visible:outline-red-700",
};

export function Button({
	className = "",
	variant = "secondary",
	...props
}: ButtonProps) {
	return (
		<ButtonPrimitive
			className={`${buttonClassName} ${variants[variant]} ${className}`}
			{...props}
		/>
	);
}
