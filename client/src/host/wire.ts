import { z } from 'zod';
import { EMOTES, MAX_FOCUS } from '../../../shared/src/constants.ts';
import { OutfitSchema } from '../../../shared/src/protocol.ts';

/**
 * What browsers say to each other through the public relay. There is no server:
 * each player publishes their own state to `<ROOT>/<room>/<their id>` and listens to `<ROOT>/<room>/+`.
 * Everything received is checked against these schemas and the room's rules before it is shown.
 */

export const ROOT = 'lanternlane/v1';

const coord = z.number().int().min(0).max(63);
const stamp = z.number().int().nonnegative();

export const PeerMsgSchema = z.discriminatedUnion('k', [
  /** Full state: sent on joining, on every change, and every few seconds as a heartbeat. */
  z.object({
    k: z.literal('s'),
    n: z.string().max(24),
    o: OutfitSchema,
    /** Tile they are on or walking to. */
    x: coord,
    y: coord,
    sit: z.boolean(),
    /** When they claimed their seat; the earlier claim wins a tie. */
    at: stamp,
    /** Focus session [startedAt, endsAt], or null. */
    f: z.tuple([stamp, stamp]).nullable(),
    /** Break end time, or null. */
    b: stamp.nullable(),
  }),
  z.object({ k: z.literal('e'), e: z.enum(EMOTES) }),
  /** Finished a session of m minutes. */
  z.object({ k: z.literal('d'), m: z.number().int().min(1).max(MAX_FOCUS) }),
  /** Leaving the room. */
  z.object({ k: z.literal('l') }),
  /** "Who is here?" Everyone answers with their state. */
  z.object({ k: z.literal('q') }),
]);
export type PeerMsg = z.infer<typeof PeerMsgSchema>;

/** A room owner's furniture, kept on the relay so visitors see it even when the owner is away. */
export const LayoutSchema = z.object({
  items: z
    .array(z.object({ id: z.number().int().min(1).max(9999), item: z.string().min(1).max(24), x: coord, y: coord }))
    .max(80),
});
