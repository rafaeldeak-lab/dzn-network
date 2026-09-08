type LegalSellerEnvironment = {
  DZN_PUBLIC_LEGAL_SELLER_NAME?: string;
  DZN_PUBLIC_LEGAL_CONTACT_ADDRESS?: string;
};

export type PublicLegalSellerDisclosure = {
  legalSellerName: string | null;
  contactAddress: string | null;
  contactAddressLines: string[];
  legalSellerNameReady: boolean;
  contactAddressReady: boolean;
  complete: boolean;
};

const PLACEHOLDER_VALUES = new Set([
  "dzn network",
  "tbd",
  "to be confirmed",
  "united kingdom",
  "uk",
]);

export function getPublicLegalSellerDisclosure(env: LegalSellerEnvironment): PublicLegalSellerDisclosure {
  const legalSellerName = cleanValue(env.DZN_PUBLIC_LEGAL_SELLER_NAME);
  const contactAddress = cleanValue(env.DZN_PUBLIC_LEGAL_CONTACT_ADDRESS);
  const contactAddressLines = contactAddress
    ? contactAddress.split(/\s*\|\s*|\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  const legalSellerNameReady = isUsableValue(legalSellerName);
  const contactAddressReady = isUsableValue(contactAddress) && contactAddressLines.length >= 2;

  return {
    legalSellerName,
    contactAddress,
    contactAddressLines,
    legalSellerNameReady,
    contactAddressReady,
    complete: legalSellerNameReady && contactAddressReady,
  };
}

function cleanValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isUsableValue(value: string | null) {
  return Boolean(value && value.length >= 3 && !PLACEHOLDER_VALUES.has(value.toLowerCase()));
}
