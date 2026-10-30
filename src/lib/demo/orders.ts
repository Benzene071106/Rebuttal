// Paid orders waiting to ship at the demo shop, for the dispute shield. Each is the
// PayPal order a seller would see after PAYMENT.CAPTURE.COMPLETED, plus how many earlier
// orders the buyer completed with the shop. Disputes the buyer filed are not listed
// here: the shield reads them from Rebuttal's own case history ("dispute memory").

export type PendingOrder = {
  key: string;
  amount: string;
  paid_hours_ago: number;
  buyer: { name: string; email: string; payer_id: string; account_status: "VERIFIED" | "UNVERIFIED"; address: string };
  ship_to: { name: string; address: string };
  item: { id: string; name: string; qty: number };
  shipping: { id: string; label: string; amount: string };
  prior_purchases: number;
};

export const PENDING_ORDERS: PendingOrder[] = [
  {
    key: "JK-1088",
    amount: "236.00",
    paid_hours_ago: 5,
    buyer: { name: "Tomas Reyes", email: "t.reyes.shop@example.com", payer_id: "QX7BUYER1088", account_status: "UNVERIFIED", address: "1450 SW 8th St, Miami, FL 33135" },
    ship_to: { name: "R. Vance c/o ParcelBridge Forwarding", address: "8200 NW 25th St, Ste 104 #FWD-55821, Doral, FL 33122" },
    item: { id: "LB-WKND-CHS", name: "Leather weekender bag, chestnut", qty: 1 },
    shipping: { id: "OVERNIGHT", label: "Overnight express", amount: "38.00" },
    prior_purchases: 0,
  },
  {
    key: "JK-1090",
    amount: "58.00",
    paid_hours_ago: 3,
    buyer: { name: "Hannah Cole", email: "hannah.cole@example.com", payer_id: "QX7BUYER1090", account_status: "VERIFIED", address: "31 Linden Ave, Madison, WI 53703" },
    ship_to: { name: "Hannah Cole", address: "31 Linden Ave, Madison, WI 53703" },
    item: { id: "PRT-SET-3", name: "Risograph print set of 3", qty: 1 },
    shipping: { id: "STANDARD", label: "Standard, tracked", amount: "6.00" },
    prior_purchases: 3,
  },
  {
    key: "JK-1093",
    amount: "148.00",
    paid_hours_ago: 1,
    // The buyer of disputed order JK-1042, ordering again.
    buyer: { name: "Dana Whitfield", email: "dana.w@example.com", payer_id: "QX7BUYER1042", account_status: "VERIFIED", address: "418 Alder St, Apt 3, Denver, CO 80203" },
    ship_to: { name: "Dana Whitfield", address: "418 Alder St, Apt 3, Denver, CO 80203" },
    item: { id: "LB-WALLET-BELT", name: "Leather card wallet and belt set", qty: 1 },
    shipping: { id: "STANDARD", label: "Standard, tracked", amount: "9.00" },
    prior_purchases: 1,
  },
];

export const pendingOrderByKey = (key: string) => PENDING_ORDERS.find((o) => o.key === key);
