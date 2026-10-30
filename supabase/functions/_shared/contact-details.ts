/** Rich contact values. Arrays replace as a unit; omitted details are preserved by callers. */
export type LabeledValue = {
  value: string;
  label?: string;
  types?: string[];
  preferred?: boolean;
  parameters?: Record<string, string[]>;
};
export type PostalAddress = Omit<LabeledValue, "value"> & {
  po_box?: string;
  extended?: string;
  street?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  country?: string;
};
export type VCardProperty = {
  name: string;
  value: string;
  group?: string;
  parameters?: Record<string, string[]>;
};
export type ContactDetails = {
  kind?: "person" | "organization";
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  name_prefix?: string;
  name_suffix?: string;
  department?: string;
  nicknames?: string[];
  callsigns?: string[];
  birthday?: string | null;
  emails?: LabeledValue[];
  phones?: LabeledValue[];
  websites?: LabeledValue[];
  addresses?: PostalAddress[];
  social_profiles?: LabeledValue[];
  instant_messages?: LabeledValue[];
  related_names?: LabeledValue[];
  dates?: LabeledValue[];
  categories?: string[];
  extra_properties?: VCardProperty[];
};
export const detailValueKeys = [
  "emails",
  "phones",
  "websites",
  "social_profiles",
  "instant_messages",
  "related_names",
  "dates",
] as const;
export const nameKeys = [
  "last_name",
  "first_name",
  "middle_name",
  "name_prefix",
  "name_suffix",
] as const;
export function primaryValue(
  values: LabeledValue[] | undefined,
): string | null {
  return (values?.find((v) => v.preferred) ?? values?.[0])?.value ?? null;
}

/** A CardDAV PUT replaces a whole card, so absent properties must explicitly clear old projections. */
export function emptyContactDetails(): ContactDetails {
  return {
    kind: "person",
    first_name: "",
    last_name: "",
    middle_name: "",
    name_prefix: "",
    name_suffix: "",
    department: "",
    nicknames: [],
    callsigns: [],
    birthday: null,
    emails: [],
    phones: [],
    websites: [],
    addresses: [],
    social_profiles: [],
    instant_messages: [],
    related_names: [],
    dates: [],
    categories: [],
    extra_properties: [],
  };
}
