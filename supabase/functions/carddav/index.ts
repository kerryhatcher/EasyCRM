import { handle } from "./carddav.ts";

Deno.serve((request) => handle(request));
