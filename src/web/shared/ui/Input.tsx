import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { inputClassName } from "./styles";

type InputProps = ComponentProps<typeof InputPrimitive>;

export const fieldInputClassName = inputClassName;

export function Input({ className = "", ...props }: InputProps) {
	return (
		<InputPrimitive
			className={`${fieldInputClassName} ${className}`}
			{...props}
		/>
	);
}
