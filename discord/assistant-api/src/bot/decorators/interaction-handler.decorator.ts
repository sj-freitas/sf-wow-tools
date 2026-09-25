import { SetMetadata } from '@nestjs/common';

export const INTERACTION_HANDLER_METADATA = 'interaction_handler_metadata';

/** `button`: a click on a message button. `modal`: a submitted pop-up form. */
export type InteractionHandlerKind = 'button' | 'modal';

export interface InteractionHandlerMetadata {
  kind: InteractionHandlerKind;
  /** The part of the component's `custom_id` before the first ":". */
  prefix: string;
}

const handler =
  (kind: InteractionHandlerKind) =>
  (prefix: string): MethodDecorator =>
    SetMetadata(INTERACTION_HANDLER_METADATA, {
      kind,
      prefix,
    } satisfies InteractionHandlerMetadata);

/**
 * Handles clicks on buttons whose `custom_id` is `<prefix>` or `<prefix>:<anything>` (the rest
 * carries state, like which conversation the button belongs to). The method returns a private
 * answer, or a modal to open.
 */
export const Button = handler('button');

/** Handles the submission of a modal whose `custom_id` starts with `<prefix>`. */
export const Modal = handler('modal');
