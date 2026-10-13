/**
 * Vehicle brands Enode accepts on `POST /users/{userId}/link` (`vendor`).
 * Labels are the names owners pick; `code` is the exact enum value. A
 * display name such as "Tesla" is rejected by Enode.
 */
export const ENODE_VEHICLE_VENDORS = [
  { code: 'ACURA', label: 'Acura' },
  { code: 'ALFAROMEO', label: 'Alfa Romeo' },
  { code: 'ALPINE', label: 'Alpine' },
  { code: 'AUDI', label: 'Audi' },
  { code: 'BMW', label: 'BMW' },
  { code: 'BYD', label: 'BYD' },
  { code: 'CHRYSLER', label: 'Chrysler' },
  { code: 'CITROEN', label: 'Citroën' },
  { code: 'CUPRA', label: 'Cupra' },
  { code: 'DACIA', label: 'Dacia' },
  { code: 'DODGE', label: 'Dodge' },
  { code: 'DS', label: 'DS' },
  { code: 'FIAT', label: 'Fiat' },
  { code: 'FORD', label: 'Ford' },
  { code: 'HONDA', label: 'Honda' },
  { code: 'HYUNDAI', label: 'Hyundai' },
  { code: 'JAGUAR', label: 'Jaguar' },
  { code: 'JEEP', label: 'Jeep' },
  { code: 'KIA', label: 'Kia' },
  { code: 'LANCIA', label: 'Lancia' },
  { code: 'LANDROVER', label: 'Land Rover' },
  { code: 'LEXUS', label: 'Lexus' },
  { code: 'LUCID', label: 'Lucid' },
  { code: 'MAZDA', label: 'Mazda' },
  { code: 'MERCEDES', label: 'Mercedes' },
  { code: 'MG', label: 'MG' },
  { code: 'MINI', label: 'MINI' },
  { code: 'NIO', label: 'NIO' },
  { code: 'NISSAN', label: 'Nissan' },
  { code: 'OPEL', label: 'Opel' },
  { code: 'PEUGEOT', label: 'Peugeot' },
  { code: 'POLESTAR', label: 'Polestar' },
  { code: 'PORSCHE', label: 'Porsche' },
  { code: 'RAM', label: 'Ram' },
  { code: 'RENAULT', label: 'Renault' },
  { code: 'RIVIAN', label: 'Rivian' },
  { code: 'SEAT', label: 'SEAT' },
  { code: 'SKODA', label: 'Škoda' },
  { code: 'SUBARU', label: 'Subaru' },
  { code: 'TESLA', label: 'Tesla' },
  { code: 'TOYOTA', label: 'Toyota' },
  { code: 'VAUXHALL', label: 'Vauxhall' },
  { code: 'VOLKSWAGEN', label: 'Volkswagen' },
  { code: 'VOLVO', label: 'Volvo' },
  { code: 'XPENG', label: 'XPENG' },
] as const;

export type EnodeVehicleVendorCode =
  (typeof ENODE_VEHICLE_VENDORS)[number]['code'];

const VENDOR_CODES: ReadonlySet<string> = new Set(
  ENODE_VEHICLE_VENDORS.map((vendor) => vendor.code),
);

export function isEnodeVehicleVendor(
  value: string,
): value is EnodeVehicleVendorCode {
  return VENDOR_CODES.has(value);
}
