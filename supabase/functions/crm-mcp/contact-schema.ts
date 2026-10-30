import { z } from "zod";
const string = z.string().max(10000);
const labels = {
  label: string.optional(),
  types: z.array(string).max(50).optional(),
  preferred: z.boolean().optional(),
  parameters: z.record(
    z.string().regex(/^[A-Za-z0-9-]+$/),
    z.array(string).max(50),
  ).optional(),
};
const value = z.strictObject({ value: string.min(1), ...labels });
const values = z.array(value).max(1000).refine(
  (v) => v.filter((x) => x.preferred).length <= 1,
  "Choose at most one preferred value",
);
const address = z.strictObject({
  ...labels,
  po_box: string.optional(),
  extended: string.optional(),
  street: string.optional(),
  locality: string.optional(),
  region: string.optional(),
  postal_code: string.optional(),
  country: string.optional(),
});
export const contactDetailsSchema = z.strictObject({
  kind: z.enum(["person", "organization"]).optional(),
  first_name: string.optional(),
  last_name: string.optional(),
  middle_name: string.optional(),
  name_prefix: string.optional(),
  name_suffix: string.optional(),
  department: string.optional(),
  nicknames: z.array(string).max(1000).optional(),
  callsigns: z.array(z.string().trim().min(1).max(64).regex(/\S/)).max(100)
    .optional()
    .describe(
      "Radio callsigns, such as amateur radio callsigns. Keep separate from the contact name.",
    ),
  birthday: string.nullable().optional().describe(
    "vCard birthday: full or partial date, date-time, or text",
  ),
  emails: values.optional(),
  phones: values.optional(),
  websites: values.optional(),
  addresses: z.array(address).max(1000).optional(),
  social_profiles: values.optional(),
  instant_messages: values.optional(),
  related_names: values.optional(),
  dates: values.optional(),
  categories: z.array(string).max(1000).optional(),
  extra_properties: z.array(z.strictObject({
    name: z.string().regex(/^[A-Za-z0-9-]+$/),
    value: z.string().max(1048576),
    group: z.string().regex(/^[A-Za-z0-9-]+$/).optional(),
    parameters: labels.parameters,
  })).max(2000).optional(),
});
