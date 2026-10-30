import type {
  ContactDetails,
  LabeledValue,
  PostalAddress,
} from "../../../supabase/functions/_shared/contact-details";
export type { ContactDetails };
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const collections = {
  emails: "Email addresses",
  phones: "Phone numbers",
  websites: "Websites",
  addresses: "Postal addresses",
  social_profiles: "Social profiles",
  instant_messages: "Instant messaging",
  related_names: "Related names",
  dates: "Other dates",
} as const;
type Collection = keyof typeof collections;
const scalarNames = {
  first_name: "First name",
  middle_name: "Middle name",
  last_name: "Last name",
  name_prefix: "Name prefix",
  name_suffix: "Name suffix",
  department: "Department",
  birthday: "Birthday",
} as const;
const addressNames = {
  po_box: "PO box",
  extended: "Apartment / additional address",
  street: "Street",
  locality: "City",
  region: "State / region",
  postal_code: "Postal code",
  country: "Country",
} as const;
const field = (
  name: string,
  label: string,
  value: unknown = "",
  type = "text",
) =>
  `<label class="form-field">${esc(label)}<input name="${
    esc(name)
  }" type="${type}" value="${esc(value)}" /></label>`;
function valueDisplay(value: string, type?: string) {
  const href = type === "emails"
    ? `mailto:${encodeURIComponent(value)}`
    : type === "phones"
    ? `tel:${encodeURIComponent(value)}`
    : type === "websites" && /^https?:\/\//i.test(value)
    ? value
    : null;
  return href
    ? `<a href="${esc(href)}" ${
      type === "websites" ? 'target="_blank" rel="noopener noreferrer"' : ""
    }>${esc(value)}</a>`
    : esc(value);
}
export function contactDetailFields(
  d: ContactDetails = {},
  email: string | null = null,
  phone: string | null = null,
): string {
  const data = {
    ...d,
    emails: d.emails ?? (email ? [{ value: email }] : []),
    phones: d.phones ?? (phone ? [{ value: phone }] : []),
  };
  const basic = Object.entries(scalarNames).filter(([k]) =>
    data[k as keyof typeof scalarNames]
  ).map(([k, label]) =>
    `<div class="detail-field"><dt>${label}</dt><dd>${
      esc(data[k as keyof typeof scalarNames])
    }</dd></div>`
  ).join("");
  const lists = Object.entries(collections).map(([key, title]) => {
    const items = data[key as Collection];
    if (!items?.length) return "";
    return `<section class="contact-field-section"><h4>${title}</h4><ul class="contact-value-list">${
      items.map((item) => {
        const value = key === "addresses"
          ? Object.keys(addressNames).map((k) =>
            (item as PostalAddress)[k as keyof typeof addressNames]
          ).filter(Boolean).join(", ")
          : (item as LabeledValue).value;
        return `<li><span>${valueDisplay(value, key)}</span><small>${
          esc(
            item.label || item.types?.filter((t) =>
              t.toLowerCase() !== "pref"
            ).join(", ") || "",
          )
        }${item.preferred ? " · Preferred" : ""}</small></li>`;
      }).join("")
    }</ul></section>`;
  }).join("");
  const tags = (data.categories ?? []).map((x) =>
    `<span class="contact-tag">${esc(x)}</span>`
  ).join("");
  const other = (data.extra_properties ?? []).map((p) =>
    `<div class="detail-field"><dt>${esc(p.name)}</dt><dd>${
      esc(p.value)
    }</dd></div>`
  ).join("");
  return `<dl class="field-grid">${
    data.kind
      ? `<div class="detail-field"><dt>Contact type</dt><dd>${
        data.kind === "organization" ? "Business" : "Person"
      }</dd></div>`
      : ""
  }${basic}${
    data.nicknames?.length
      ? `<div class="detail-field"><dt>Nicknames</dt><dd>${
        esc(data.nicknames.join(", "))
      }</dd></div>`
      : ""
  }${
    data.callsigns?.length
      ? `<div class="detail-field"><dt>Radio callsigns</dt><dd>${
        esc(data.callsigns.join(", "))
      }</dd></div>`
      : ""
  }</dl>${lists}${
    tags
      ? `<section class="contact-field-section"><h4>Tags</h4><div class="contact-tags">${tags}</div></section>`
      : ""
  }${
    other
      ? `<details class="contact-field-section"><summary>Additional contact information</summary><dl class="field-grid">${other}</dl></details>`
      : ""
  }`;
}
export function contactValueRow(
  key: Collection,
  value: LabeledValue | PostalAddress,
  index = -1,
): string {
  const inputType = key === "emails"
    ? "email"
    : key === "phones"
    ? "tel"
    : key === "websites"
    ? "url"
    : "text";
  return `<fieldset class="contact-value-editor" data-detail-row data-original-index="${index}"><legend>${
    esc(collections[key])
  }</legend><div class="form-grid">${
    key === "addresses"
      ? Object.entries(addressNames).map(([k, label]) =>
        field(
          k,
          label,
          (value as PostalAddress)[k as keyof typeof addressNames],
        )
      ).join("")
      : field("value", "Value", (value as LabeledValue).value, inputType)
  }${field("label", "Label", value.label)}${
    field("types", "Types (comma separated)", value.types?.join(", "))
  }</div><div class="contact-value-actions"><label><input type="checkbox" name="preferred" ${
    value.preferred ? "checked" : ""
  }/> Preferred</label><button class="text-button" type="button" data-action="remove-contact-value">Remove</button></div></fieldset>`;
}
export function contactDetailsForm(
  d: ContactDetails = {},
  email: string | null = null,
  phone: string | null = null,
): string {
  const data = {
    ...d,
    emails: d.emails ?? (email ? [{ value: email }] : []),
    phones: d.phones ?? (phone ? [{ value: phone }] : []),
  };
  return `<section class="rich-contact-form"><h3>Name and personal details</h3><div class="form-grid"><label class="form-field">Contact type<select name="detail.kind"><option value="person" ${
    data.kind !== "organization" ? "selected" : ""
  }>Person</option><option value="organization" ${
    data.kind === "organization" ? "selected" : ""
  }>Business</option></select></label>${
    Object.entries(scalarNames).map(([k, label]) =>
      field("detail." + k, label, data[k as keyof typeof scalarNames])
    ).join("")
  }<label class="form-field">Nicknames (one per line)<textarea name="detail.nicknames" rows="2">${
    esc(data.nicknames?.join("\n"))
  }</textarea></label><label class="form-field">Radio callsigns (one per line)<textarea name="detail.callsigns" rows="2" placeholder="W1GUU">${
    esc(data.callsigns?.join("\n"))
  }</textarea></label></div><p class="quiet">Birthday: YYYY-MM-DD, or --MM-DD when the year is unknown. Display name is independent of these name parts.</p><label class="form-field">Tags (one per line)<textarea name="detail.categories" rows="3">${
    esc(data.categories?.join("\n"))
  }</textarea></label>${
    Object.entries(collections).map(([key, title]) =>
      `<details class="contact-field-section" ${
        (key === "emails" || key === "phones") ? "open" : ""
      }><summary>${title} (${
        data[key as Collection]?.length ?? 0
      })</summary><div data-detail-collection="${key}">${
        (data[key as Collection] ?? []).map((v, i) =>
          contactValueRow(key as Collection, v, i)
        ).join("")
      }</div><button class="text-button" type="button" data-action="add-contact-value" data-collection="${key}">Add ${title.toLowerCase()}</button></details>`
    ).join("")
  }</section>`;
}
export function addContactValue(button: HTMLButtonElement): void {
  if (button.dataset.action === "remove-contact-value") {
    button.closest("[data-detail-row]")?.remove();
    return;
  }
  const key = button.dataset.collection as Collection;
  button.parentElement!.querySelector(`[data-detail-collection="${key}"]`)!
    .insertAdjacentHTML("beforeend", contactValueRow(key, { value: "" }));
}
export function readContactDetails(
  form: HTMLFormElement,
  old: ContactDetails = {},
): ContactDetails {
  const fd = new FormData(form);
  const d = { ...old };
  d.kind = fd.get("detail.kind") === "organization" ? "organization" : "person";
  for (const key of Object.keys(scalarNames) as (keyof typeof scalarNames)[]) {
    const v = String(fd.get("detail." + key) ?? "").trim();
    if (key === "birthday") d.birthday = v || null;
    else d[key] = v;
  }
  d.nicknames = String(fd.get("detail.nicknames") ?? "").split("\n").map((v) =>
    v.trim()
  ).filter(Boolean);
  d.callsigns = [
    ...new Set(
      String(fd.get("detail.callsigns") ?? "").split("\n").map((v) =>
        v.trim().toUpperCase()
      ).filter(Boolean),
    ),
  ];
  d.categories = String(fd.get("detail.categories") ?? "").split("\n").map(
    (v) => v.trim(),
  ).filter(Boolean);
  for (const key of Object.keys(collections) as Collection[]) {
    const rows = form.querySelectorAll<HTMLElement>(
      `[data-detail-collection="${key}"] [data-detail-row]`,
    );
    const entries = Array.from(rows).map((row) => {
      const original = old[key]?.[Number(row.dataset.originalIndex)] ?? {};
      const get = (n: string) =>
        row.querySelector<HTMLInputElement>(`[name="${n}"]`)?.value.trim() ??
          "";
      const v = {
        ...original,
        label: get("label"),
        types: get("types").split(",").map((v) => v.trim()).filter(Boolean),
        preferred:
          row.querySelector<HTMLInputElement>('[name="preferred"]')!.checked,
      };
      if (key === "addresses") {
        return {
          ...v,
          ...Object.fromEntries(
            Object.keys(addressNames).map((k) => [k, get(k)]),
          ),
        };
      }
      const value = get("value");
      if (!value) {
        throw new Error(
          `Enter a value for ${
            collections[key].toLowerCase()
          } or remove the empty row.`,
        );
      }
      return { ...v, value };
    });
    if (entries.filter((v) => v.preferred).length > 1) {
      throw new Error(
        `Choose only one preferred value for ${
          collections[key].toLowerCase()
        }.`,
      );
    }
    (d as Record<string, unknown>)[key] = entries;
  }
  return d;
}
