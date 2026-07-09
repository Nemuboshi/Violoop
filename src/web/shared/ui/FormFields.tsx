import { Field } from "@base-ui/react/field";
import type { ComponentProps, ReactElement } from "react";
import { fieldInputClassName } from "./Input";
import {
	fieldErrorClassName,
	fieldLabelClassName,
	fieldRootClassName,
} from "./styles";

type TextFieldProps = {
	label: string;
	value: string;
	type?: "text" | "password" | "number";
	onChange(value: string): void;
};

type TextAreaFieldProps = {
	label?: string;
	value: string;
	className?: string;
	controlClassName?: string;
	rows?: number;
	placeholder?: string;
	onChange(value: string): void;
	onKeyDown?: ComponentProps<"textarea">["onKeyDown"];
};

export function TextField(props: TextFieldProps) {
	return (
		<Field.Root className={fieldRootClassName}>
			<Field.Label className={fieldLabelClassName}>{props.label}</Field.Label>
			<Field.Control
				className={fieldInputClassName}
				type={props.type ?? "text"}
				value={props.value}
				onValueChange={props.onChange}
			/>
			<Field.Error className={fieldErrorClassName} />
		</Field.Root>
	);
}

export function TextAreaField(props: TextAreaFieldProps) {
	return (
		<Field.Root className={`${fieldRootClassName} ${props.className ?? ""}`}>
			{props.label ? (
				<Field.Label className={fieldLabelClassName}>{props.label}</Field.Label>
			) : null}
			<Field.Control
				className={`${fieldInputClassName} min-h-24 resize-y py-1.5 ${props.controlClassName ?? ""}`}
				value={props.value}
				onValueChange={props.onChange}
				render={
					(
						<textarea
							rows={props.rows}
							placeholder={props.placeholder}
							onKeyDown={props.onKeyDown}
						/>
					) as ReactElement
				}
			/>
			<Field.Error className={fieldErrorClassName} />
		</Field.Root>
	);
}
