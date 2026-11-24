import type {
  DeviceCompatibilityRecord,
  EsimProductRecord,
  EsimStockItemRecord,
  NumberTier,
  OperatorCode,
  OperatorConfigRecord,
  PhoneProductRecord,
  PublicNumberOption,
  SupplyMethod,
} from '../../../src/types/domain.ts';

export interface OperatorFulfillmentInput {
  orderId: string;
  orderNumber: string;
  operatorCode: OperatorCode;
  supplyMethod: SupplyMethod;
  stockItem: EsimStockItemRecord | null;
  reservedMsisdn: string | null;
  deviceModel: string | null;
  productType?: 'new_esim_line' | 'sim_to_esim_conversion';
  existingMsisdn?: string | null;
  sandboxBehavior?: 'success' | 'pending' | 'failure' | 'unavailable_on_recheck';
}

export interface OperatorFulfillmentOutput {
  outcome: 'provisioned' | 'operator_pending' | 'awaiting_manual_fulfillment' | 'failed';
  assignedMsisdn: string | null;
  iccid: string | null;
  eid: string | null;
  smdpAddress: string | null;
  activationCode: string | null;
  lpaUri: string | null;
  qrPayload: string | null;
  providerReference: string | null;
  failureReason: string | null;
  isSandboxSimulation: boolean;
  requiresRefundOnFailure?: boolean;
}

export interface OperatorAvailabilityCheckResult {
  available: boolean;
  reservationSupported: boolean;
  reason: string | null;
}

export interface OperatorSupplyAdapter {
  readonly method: SupplyMethod;
  listAvailableNumbers?(operatorCode: OperatorCode): PublicNumberOption[];
  checkNumberAvailability?(
    operatorCode: OperatorCode,
    msisdn: string,
    sandboxUnavailable?: boolean,
  ): Promise<OperatorAvailabilityCheckResult>;
  fulfill(input: OperatorFulfillmentInput): Promise<OperatorFulfillmentOutput>;
  pollStatus?(input: {
    orderId: string;
    orderNumber: string;
    operatorCode: OperatorCode;
    reservedMsisdn: string | null;
    providerReference: string | null;
    forceOutcome?: 'provisioned' | 'failed' | 'operator_pending';
  }): Promise<OperatorFulfillmentOutput>;
  cancelOrReverse?(input: {
    operatorCode: OperatorCode;
    providerReference: string | null;
  }): Promise<{ cancelled: boolean; note: string }>;
}

/**
 * Model A: Stock-Based Supply Adapter
 * Consumes pre-allocated, encrypted stock credentials already validated in Yene Tele inventory.
 */
export class StockSupplyAdapter implements OperatorSupplyAdapter {
  public readonly method: SupplyMethod = 'stock_based';

  async checkNumberAvailability(
    _operatorCode: OperatorCode,
    _msisdn: string,
  ): Promise<OperatorAvailabilityCheckResult> {
    return {
      available: true,
      reservationSupported: true,
      reason: null,
    };
  }

  async fulfill(
    input: OperatorFulfillmentInput,
    decryptedCreds?: {
      smdpAddress: string;
      activationCode: string;
      lpaUri: string;
      qrPayload: string;
    },
  ): Promise<OperatorFulfillmentOutput> {
    if (!input.stockItem || !decryptedCreds) {
      return {
        outcome: 'failed',
        assignedMsisdn: null,
        iccid: null,
        eid: null,
        smdpAddress: null,
        activationCode: null,
        lpaUri: null,
        qrPayload: null,
        providerReference: null,
        failureReason: 'No reserved stock inventory item is available for fulfillment.',
        isSandboxSimulation: true,
        requiresRefundOnFailure: true,
      };
    }

    return {
      outcome: 'provisioned',
      assignedMsisdn: input.stockItem.msisdn ?? input.reservedMsisdn,
      iccid: input.stockItem.iccid,
      eid: input.stockItem.eid,
      smdpAddress: decryptedCreds.smdpAddress,
      activationCode: decryptedCreds.activationCode,
      lpaUri: decryptedCreds.lpaUri,
      qrPayload: decryptedCreds.qrPayload,
      providerReference: `STK-${input.stockItem.batchId.slice(0, 8).toUpperCase()}-${input.orderNumber}`,
      failureReason: null,
      isSandboxSimulation: input.stockItem.sourceEnvironment === 'sandbox_demo',
    };
  }

  async cancelOrReverse(): Promise<{ cancelled: boolean; note: string }> {
    return {
      cancelled: true,
      note: 'Stock reservation released back to available pool.',
    };
  }
}

const SANDBOX_DIRECT_POOL: Record<OperatorCode, Array<{ id: string; msisdn: string; tier: NumberTier }>> = {
  ethio_telecom: [
    { id: 'dir-et-901', msisdn: '+251900880101', tier: 'standard' },
    { id: 'dir-et-902', msisdn: '+251900880202', tier: 'bronze' },
    { id: 'dir-et-903', msisdn: '+251900880777', tier: 'gold' },
    { id: 'dir-et-998', msisdn: '+251900889998', tier: 'silver' },
  ],
  safaricom_ethiopia: [
    { id: 'dir-sf-901', msisdn: '+251700880101', tier: 'standard' },
    { id: 'dir-sf-902', msisdn: '+251700880303', tier: 'silver' },
    { id: 'dir-sf-903', msisdn: '+251700880888', tier: 'platinum' },
    { id: 'dir-sf-998', msisdn: '+251700889998', tier: 'bronze' },
  ],
};

/**
 * Model B: Direct Operator API Adapter
 * Encapsulates independent operator capabilities for Ethio telecom and Safaricom Ethiopia.
 * Never hardcodes one operator's reservation behavior as applying to the other.
 */
export class DirectOperatorApiAdapter implements OperatorSupplyAdapter {
  public readonly method: SupplyMethod = 'direct_api';
  private readonly operatorConfigs: Map<OperatorCode, OperatorConfigRecord>;

  constructor(operatorConfigs: Map<OperatorCode, OperatorConfigRecord>) {
    this.operatorConfigs = operatorConfigs;
  }

  public listAvailableNumbers(operatorCode: OperatorCode): PublicNumberOption[] {
    const cfg = this.operatorConfigs.get(operatorCode);
    if (!cfg || !cfg.isEnabled || cfg.integrationStatus === 'coming_soon') {
      return [];
    }
    const pool = SANDBOX_DIRECT_POOL[operatorCode] ?? [];
    return pool.map((entry) => ({
      id: entry.id,
      operatorCode,
      msisdn: entry.msisdn,
      numberTier: entry.tier,
      sourceEnvironment: 'sandbox_direct_api',
      supplyMethod: 'direct_api',
      supportsPrePaymentReservation: cfg.supportsPrePaymentReservation,
    }));
  }

  public async checkNumberAvailability(
    operatorCode: OperatorCode,
    msisdn: string,
    sandboxUnavailable = false,
  ): Promise<OperatorAvailabilityCheckResult> {
    const cfg = this.operatorConfigs.get(operatorCode);
    if (!cfg || !cfg.isEnabled || cfg.integrationStatus === 'coming_soon') {
      return {
        available: false,
        reservationSupported: false,
        reason: 'Operator direct integration is disabled or not yet authorized.',
      };
    }

    if (cfg.integrationStatus === 'sandbox' && (sandboxUnavailable || msisdn.endsWith('9999'))) {
      return {
        available: false,
        reservationSupported: cfg.supportsPrePaymentReservation,
        reason: 'Selected number failed direct operator availability recheck at fulfillment.',
      };
    }

    return {
      available: true,
      reservationSupported: cfg.supportsPrePaymentReservation,
      reason: null,
    };
  }

  async fulfill(input: OperatorFulfillmentInput): Promise<OperatorFulfillmentOutput> {
    const cfg = this.operatorConfigs.get(input.operatorCode);
    if (!cfg || !cfg.isEnabled || cfg.integrationStatus === 'coming_soon') {
      return {
        outcome: 'awaiting_manual_fulfillment',
        assignedMsisdn: input.reservedMsisdn,
        iccid: null,
        eid: null,
        smdpAddress: null,
        activationCode: null,
        lpaUri: null,
        qrPayload: null,
        providerReference: null,
        failureReason:
          'Direct operator API is not yet authorized for this operator. Routed to Authorized Manual Partner Processing.',
        isSandboxSimulation: true,
      };
    }

    if (cfg.integrationStatus === 'live') {
      return {
        outcome: 'failed',
        assignedMsisdn: null,
        iccid: null,
        eid: null,
        smdpAddress: null,
        activationCode: null,
        lpaUri: null,
        qrPayload: null,
        providerReference: null,
        failureReason:
          'Live operator HTTPS client credentials must be configured via partner onboarding secrets.',
        isSandboxSimulation: false,
        requiresRefundOnFailure: true,
      };
    }

    // Recheck availability when operator does not lock numbers prior to payment
    if (!cfg.supportsPrePaymentReservation && input.reservedMsisdn) {
      const recheck = await this.checkNumberAvailability(
        input.operatorCode,
        input.reservedMsisdn,
        input.sandboxBehavior === 'unavailable_on_recheck',
      );
      if (!recheck.available) {
        return {
          outcome: 'failed',
          assignedMsisdn: input.reservedMsisdn,
          iccid: null,
          eid: null,
          smdpAddress: null,
          activationCode: null,
          lpaUri: null,
          qrPayload: null,
          providerReference: `SBX-CHK-${input.orderNumber}`,
          failureReason: recheck.reason ?? 'Number no longer available upon operator recheck.',
          isSandboxSimulation: true,
          requiresRefundOnFailure: true,
        };
      }
    }

    if (input.sandboxBehavior === 'failure' || input.reservedMsisdn?.endsWith('9999')) {
      return {
        outcome: 'failed',
        assignedMsisdn: input.reservedMsisdn,
        iccid: null,
        eid: null,
        smdpAddress: null,
        activationCode: null,
        lpaUri: null,
        qrPayload: null,
        providerReference: `SBX-FAIL-${input.orderNumber}`,
        failureReason: 'Sandbox operator API rejected provisioning request.',
        isSandboxSimulation: true,
        requiresRefundOnFailure: true,
      };
    }

    if (input.sandboxBehavior === 'pending' || input.reservedMsisdn?.endsWith('9998')) {
      return {
        outcome: 'operator_pending',
        assignedMsisdn: input.reservedMsisdn,
        iccid: null,
        eid: null,
        smdpAddress: null,
        activationCode: null,
        lpaUri: null,
        qrPayload: null,
        providerReference: `SBX-PEND-${input.orderNumber}`,
        failureReason: null,
        isSandboxSimulation: true,
      };
    }

    return this.buildSimulatedProfile(input.orderId, input.orderNumber, input.operatorCode, input.reservedMsisdn);
  }

  async pollStatus(input: {
    orderId: string;
    orderNumber: string;
    operatorCode: OperatorCode;
    reservedMsisdn: string | null;
    providerReference: string | null;
    forceOutcome?: 'provisioned' | 'failed' | 'operator_pending';
  }): Promise<OperatorFulfillmentOutput> {
    const cfg = this.operatorConfigs.get(input.operatorCode);
    if (cfg?.integrationStatus === 'live') {
      return {
        outcome: 'failed',
        assignedMsisdn: input.reservedMsisdn,
        iccid: null,
        eid: null,
        smdpAddress: null,
        activationCode: null,
        lpaUri: null,
        qrPayload: null,
        providerReference: input.providerReference,
        failureReason: 'Live operator status endpoint requires partner credentials.',
        isSandboxSimulation: false,
      };
    }

    if (input.forceOutcome === 'failed') {
      return {
        outcome: 'failed',
        assignedMsisdn: input.reservedMsisdn,
        iccid: null,
        eid: null,
        smdpAddress: null,
        activationCode: null,
        lpaUri: null,
        qrPayload: null,
        providerReference: input.providerReference,
        failureReason: 'Operator async provisioning timed out in sandbox simulation.',
        isSandboxSimulation: true,
        requiresRefundOnFailure: true,
      };
    }

    if (input.forceOutcome === 'operator_pending') {
      return {
        outcome: 'operator_pending',
        assignedMsisdn: input.reservedMsisdn,
        iccid: null,
        eid: null,
        smdpAddress: null,
        activationCode: null,
        lpaUri: null,
        qrPayload: null,
        providerReference: input.providerReference,
        failureReason: null,
        isSandboxSimulation: true,
      };
    }

    return this.buildSimulatedProfile(input.orderId, input.orderNumber, input.operatorCode, input.reservedMsisdn);
  }

  async cancelOrReverse(input: {
    operatorCode: OperatorCode;
    providerReference: string | null;
  }): Promise<{ cancelled: boolean; note: string }> {
    const cfg = this.operatorConfigs.get(input.operatorCode);
    if (!cfg || cfg.integrationStatus === 'live') {
      return { cancelled: false, note: 'Live cancellation requires signed partner API credentials.' };
    }
    return {
      cancelled: true,
      note: `Sandbox reversal acknowledged for reference ${input.providerReference ?? 'none'}.`,
    };
  }

  private buildSimulatedProfile(
    orderId: string,
    orderNumber: string,
    operatorCode: OperatorCode,
    reservedMsisdn: string | null,
  ): OperatorFulfillmentOutput {
    const token = orderId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 14).toUpperCase();
    const smdp = `sandbox-smdp.${operatorCode.replace('_', '')}.yene.invalid`;
    const activationCode = `SANDBOX-${token}`;
    const lpaUri = `LPA:1$${smdp}$${activationCode}`;

    return {
      outcome: 'provisioned',
      assignedMsisdn: reservedMsisdn,
      iccid: `8925100000${token.slice(0, 8)}`,
      eid: null,
      smdpAddress: smdp,
      activationCode,
      lpaUri,
      qrPayload: lpaUri,
      providerReference: `SBX-API-${orderNumber}`,
      failureReason: null,
      isSandboxSimulation: true,
    };
  }
}

/**
 * Model C: Authorized Manual Partner Processing Adapter
 * Moves verified orders cleanly into the operations fulfillment queue without inventing fake QR data.
 */
export class ManualPartnerProcessingAdapter implements OperatorSupplyAdapter {
  public readonly method: SupplyMethod = 'manual_processing';

  async checkNumberAvailability(): Promise<OperatorAvailabilityCheckResult> {
    return {
      available: true,
      reservationSupported: false,
      reason: 'Number is assigned and verified by authorized partner staff upon fulfillment.',
    };
  }

  async fulfill(input: OperatorFulfillmentInput): Promise<OperatorFulfillmentOutput> {
    return {
      outcome: 'awaiting_manual_fulfillment',
      assignedMsisdn: input.reservedMsisdn,
      iccid: null,
      eid: null,
      smdpAddress: null,
      activationCode: null,
      lpaUri: null,
      qrPayload: null,
      providerReference: `MAN-QUEUE-${input.orderNumber}`,
      failureReason: null,
      isSandboxSimulation: true,
    };
  }

  async cancelOrReverse(): Promise<{ cancelled: boolean; note: string }> {
    return {
      cancelled: true,
      note: 'Removed from manual partner fulfillment queue.',
    };
  }
}

export function buildSeedOperatorConfigs(): OperatorConfigRecord[] {
  const now = new Date().toISOString();
  return [
    {
      operatorCode: 'ethio_telecom',
      displayName: 'Ethio telecom',
      isEnabled: true,
      integrationStatus: 'sandbox',
      activeSupplyMethod: 'stock_based',
      supportedEsimTypes: ['new_esim_line'],
      numberAvailabilityMode: 'stock_pool',
      supportsPrePaymentReservation: true,
      provisioningStatus: 'operational_sandbox',
      supportsNewNumber: true,
      supportsSimConversion: false,
      kycRequired: true,
      customerVisibleNote:
        'Sandbox preview active. Official Ethio telecom partnership onboarding and live teleSIM API connection pending commercial agreement.',
      healthSummary: {
        totalOrders: 0,
        provisionedOrders: 0,
        pendingOrders: 0,
        failedOrders: 0,
        lastCheckedAt: now,
      },
      updatedAt: now,
    },
    {
      operatorCode: 'safaricom_ethiopia',
      displayName: 'Safaricom Ethiopia',
      isEnabled: true,
      integrationStatus: 'sandbox',
      activeSupplyMethod: 'manual_processing',
      supportedEsimTypes: ['new_esim_line'],
      numberAvailabilityMode: 'operator_assigned',
      supportsPrePaymentReservation: false,
      provisioningStatus: 'manual_queue',
      supportsNewNumber: true,
      supportsSimConversion: false,
      kycRequired: true,
      customerVisibleNote:
        'Sandbox preview active. Live Safaricom Ethiopia eSIM remote API is pending formal commercial authorization; manual authorized partner workflow is modeled.',
      healthSummary: {
        totalOrders: 0,
        provisionedOrders: 0,
        pendingOrders: 0,
        failedOrders: 0,
        lastCheckedAt: now,
      },
      updatedAt: now,
    },
  ];
}

export function buildSeedEsimProducts(): EsimProductRecord[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'prod-ethio-new-line',
      operatorCode: 'ethio_telecom',
      productType: 'new_esim_line',
      name: 'Ethio telecom Digital eSIM Line',
      nameAm: 'የኢትዮ ቴሌኮም ዲጂታል eSIM መስመር',
      description:
        'Acquire a new Ethiopian mobile number as an eSIM profile through Yene Tele after Fayda identity consent.',
      descriptionAm:
        'በፋይዳ ማንነት ፍቃድ ማረጋገጫ በኋላ በየኔ ቴሌ አዲስ የኢትዮጵያ የሞባይል ቁጥር በeSIM ያግኙ።',
      priceEtb: null,
      sandboxPreviewAmountEtb: 150,
      pricingStatus: 'pending_operator_agreement',
      isActive: true,
      requiresFaydaKyc: true,
      updatedAt: now,
    },
    {
      id: 'prod-safari-new-line',
      operatorCode: 'safaricom_ethiopia',
      productType: 'new_esim_line',
      name: 'Safaricom Ethiopia Digital eSIM Line',
      nameAm: 'የሳፋሪኮም ኢትዮጵያ ዲጂታል eSIM መስመር',
      description:
        'Digital Safaricom Ethiopia eSIM onboarding flow (partner-routed fulfillment pending live operator API authorization).',
      descriptionAm:
        'የሳፋሪኮም ኢትዮጵያ ዲጂታል eSIM አገልግሎት (የኦፕሬተር ቀጥታ API ፍቃድ እስኪጠናቀቅ በተፈቀደ አጋር ሂደት)።',
      priceEtb: null,
      sandboxPreviewAmountEtb: 150,
      pricingStatus: 'pending_operator_agreement',
      isActive: true,
      requiresFaydaKyc: true,
      updatedAt: now,
    },
    {
      id: 'prod-ethio-sim-conv',
      operatorCode: 'ethio_telecom',
      productType: 'sim_to_esim_conversion',
      name: 'Physical SIM to eSIM Conversion',
      nameAm: 'ፊዚካል ሲም ወደ eSIM መቀየሪያ',
      description:
        'Convert an existing physical SIM line to an eSIM once formal operator conversion authorization is enabled.',
      descriptionAm:
        'የኦፕሬተር ፍቃድ ሲጸድቅ ነባር ፊዚካል ሲም ወደ eSIM መቀየር።',
      priceEtb: null,
      sandboxPreviewAmountEtb: null,
      pricingStatus: 'pending_operator_agreement',
      isActive: false,
      requiresFaydaKyc: true,
      updatedAt: now,
    },
    {
      id: 'prod-safari-sim-conv',
      operatorCode: 'safaricom_ethiopia',
      productType: 'sim_to_esim_conversion',
      name: 'Safaricom Physical SIM to eSIM Conversion',
      nameAm: 'የሳፋሪኮም ፊዚካል ሲም ወደ eSIM መቀየሪያ',
      description:
        'Convert an existing Safaricom Ethiopia physical SIM once formal operator authorization and ownership verification are active.',
      descriptionAm:
        'የኦፕሬተር ፍቃድ ሲጸድቅ ነባር ሳፋሪኮም ፊዚካል ሲም ወደ eSIM መቀየር።',
      priceEtb: null,
      sandboxPreviewAmountEtb: null,
      pricingStatus: 'pending_operator_agreement',
      isActive: false,
      requiresFaydaKyc: true,
      updatedAt: now,
    },
  ];
}

export function buildSeedDeviceCompatibility(): DeviceCompatibilityRecord[] {
  return [
    {
      id: 'dev-iphone-16',
      brand: 'Apple',
      modelFamily: 'iPhone 16 / 16 Plus / 16 Pro / 16 Pro Max',
      osPlatform: 'ios',
      minOsVersion: 'iOS 18',
      esimSupported: true,
      dualEsimSupported: true,
      regionalCaveat: 'Models sold in mainland China do not include hardware eSIM.',
    },
    {
      id: 'dev-iphone-15',
      brand: 'Apple',
      modelFamily: 'iPhone 15 / 15 Plus / 15 Pro / 15 Pro Max',
      osPlatform: 'ios',
      minOsVersion: 'iOS 17',
      esimSupported: true,
      dualEsimSupported: true,
      regionalCaveat: 'Mainland China variants are dual physical SIM only.',
    },
    {
      id: 'dev-iphone-14',
      brand: 'Apple',
      modelFamily: 'iPhone 14 / 13 / 12 / 11 / XS / XR / SE (2nd & 3rd gen)',
      osPlatform: 'ios',
      minOsVersion: 'iOS 12.1+',
      esimSupported: true,
      dualEsimSupported: true,
      regionalCaveat: 'Dual active eSIM requires iPhone 13 or later; verify device is carrier-unlocked.',
    },
    {
      id: 'dev-samsung-s24-s25',
      brand: 'Samsung',
      modelFamily: 'Galaxy S25 / S24 / S23 / S22 / S21 / S20 Series',
      osPlatform: 'android',
      minOsVersion: 'Android 12+',
      esimSupported: true,
      dualEsimSupported: true,
      regionalCaveat: 'Most China/Hong Kong/Taiwan variants and certain carrier-locked FE editions omit eSIM.',
    },
    {
      id: 'dev-samsung-fold',
      brand: 'Samsung',
      modelFamily: 'Galaxy Z Fold 3–6 & Z Flip 3–6',
      osPlatform: 'android',
      minOsVersion: 'Android 12+',
      esimSupported: true,
      dualEsimSupported: false,
      regionalCaveat: 'Check Settings -> Connections -> SIM manager for "Add eSIM".',
    },
    {
      id: 'dev-pixel',
      brand: 'Google',
      modelFamily: 'Pixel 9 / 8 / 7 / 6 / 5 / 4a / 4 Series',
      osPlatform: 'android',
      minOsVersion: 'Android 11+',
      esimSupported: true,
      dualEsimSupported: true,
      regionalCaveat: 'Pixel 7 and later support dual active eSIM; some Japanese carrier locks restrict eSIM.',
    },
    {
      id: 'dev-xiaomi',
      brand: 'Xiaomi',
      modelFamily: 'Xiaomi 14 / 13 / 13T / 12T Pro & Redmi Note 13 Pro+ 5G (Global)',
      osPlatform: 'android',
      minOsVersion: 'HyperOS / MIUI 14+',
      esimSupported: true,
      dualEsimSupported: false,
      regionalCaveat: 'Global ROM variants only; Chinese domestic units do not support eSIM.',
    },
    {
      id: 'dev-samsung-a',
      brand: 'Samsung',
      modelFamily: 'Galaxy A55 5G / A54 5G / A35 5G',
      osPlatform: 'android',
      minOsVersion: 'Android 13+',
      esimSupported: true,
      dualEsimSupported: false,
      regionalCaveat: 'eSIM availability depends on regional CSC firmware — dial *#06# to confirm EID.',
    },
    {
      id: 'dev-tecno-budget',
      brand: 'Tecno / Infinix',
      modelFamily: 'Most Standard Budget Physical-SIM Models',
      osPlatform: 'android',
      minOsVersion: 'Android 12+',
      esimSupported: false,
      dualEsimSupported: false,
      regionalCaveat: 'Most entry-level models require a physical SIM card or upgrading to an eSIM-capable handset.',
    },
  ];
}

export function buildSeedPhoneProducts(): PhoneProductRecord[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'phone-iphone-15-128',
      brand: 'Apple',
      category: 'iphone',
      model: 'iPhone 15',
      exactModelNumber: 'A3090',
      regionalVariant: 'Global / Middle East (Dual eSIM + Nano-SIM)',
      storage: '128 GB',
      condition: 'Brand New · Sealed',
      warrantySummary: '12-Month Apple International Hardware Warranty',
      esimCapable: true,
      esimCompatibilityStatus: 'verified_compatible',
      networkUnlockStatus: 'verified_unlocked',
      ethioTelecomCompatibility: 'unverified',
      safaricomCompatibility: 'unverified',
      compatibilityNotes:
        'A3090 hardware includes embedded eSIM (EID verified) and supports standard GSMA LPA QR activation. Live Ethiopian operator certification awaits partner sign-off.',
      compatibilityEvidence: 'GSMA EID hardware spec verified for model A3090 (excludes Mainland China A3092).',
      imageKey: 'iphone-15',
      imageUrl: null,
      isFeatured: true,
      unitPriceEtb: null,
      sandboxPreviewPriceEtb: 89500,
      pricingStatus: 'pending_commercial_quote',
      stockQty: 6,
      bulkMinimumQty: 5,
      supportsBulkOrder: true,
      deliveryPartner: 'klick',
      isActive: true,
      updatedAt: now,
    },
    {
      id: 'phone-iphone-16-pro-256',
      brand: 'Apple',
      category: 'iphone',
      model: 'iPhone 16 Pro',
      exactModelNumber: 'A3293',
      regionalVariant: 'Global Unlocked (Dual Active eSIM)',
      storage: '256 GB',
      condition: 'Brand New · Sealed',
      warrantySummary: '12-Month Apple International Hardware Warranty',
      esimCapable: true,
      esimCompatibilityStatus: 'verified_compatible',
      networkUnlockStatus: 'verified_unlocked',
      ethioTelecomCompatibility: 'unverified',
      safaricomCompatibility: 'unverified',
      compatibilityNotes:
        'Global A3293 model supports dual active eSIM profiles simultaneously and standard LPA QR installation.',
      compatibilityEvidence: 'Apple A3293 hardware spec confirmed factory unlocked with embedded EID.',
      imageKey: 'iphone-16-pro',
      imageUrl: null,
      isFeatured: true,
      unitPriceEtb: null,
      sandboxPreviewPriceEtb: 142000,
      pricingStatus: 'pending_commercial_quote',
      stockQty: 4,
      bulkMinimumQty: 5,
      supportsBulkOrder: true,
      deliveryPartner: 'klick',
      isActive: true,
      updatedAt: now,
    },
    {
      id: 'phone-galaxy-s24-256',
      brand: 'Samsung',
      category: 'samsung_galaxy',
      model: 'Galaxy S24',
      exactModelNumber: 'SM-S921B/DS',
      regionalVariant: 'Global / MEA Unlocked',
      storage: '256 GB',
      condition: 'Brand New · Sealed',
      warrantySummary: '12-Month Distributor Warranty',
      esimCapable: true,
      esimCompatibilityStatus: 'verified_compatible',
      networkUnlockStatus: 'verified_unlocked',
      ethioTelecomCompatibility: 'unverified',
      safaricomCompatibility: 'unverified',
      compatibilityNotes:
        'SM-S921B/DS international Dual-SIM + eSIM variant includes Samsung SIM Manager eSIM support. Excludes HK/CN SM-S9210.',
      compatibilityEvidence: 'Verified SM-S921B/DS regional CSC firmware includes eSIM EID support.',
      imageKey: 'galaxy-s24',
      imageUrl: null,
      isFeatured: true,
      unitPriceEtb: null,
      sandboxPreviewPriceEtb: 76000,
      pricingStatus: 'pending_commercial_quote',
      stockQty: 8,
      bulkMinimumQty: 5,
      supportsBulkOrder: true,
      deliveryPartner: 'klick',
      isActive: true,
      updatedAt: now,
    },
    {
      id: 'phone-pixel-8a-128',
      brand: 'Google',
      category: 'google_pixel',
      model: 'Pixel 8a',
      exactModelNumber: 'G6GPR',
      regionalVariant: 'Global Unlocked',
      storage: '128 GB',
      condition: 'Brand New · Sealed',
      warrantySummary: '12-Month Supplier Warranty',
      esimCapable: true,
      esimCompatibilityStatus: 'verified_compatible',
      networkUnlockStatus: 'verified_unlocked',
      ethioTelecomCompatibility: 'unverified',
      safaricomCompatibility: 'unverified',
      compatibilityNotes:
        'Factory-unlocked G6GPR model supports Android GSMA eSIM profiles and dual active SIM (1 physical + 1 eSIM).',
      compatibilityEvidence: 'Google Pixel 8a G6GPR unlocked global SKU verified for EID support.',
      imageKey: 'pixel-8a',
      imageUrl: null,
      isFeatured: true,
      unitPriceEtb: null,
      sandboxPreviewPriceEtb: 48000,
      pricingStatus: 'pending_commercial_quote',
      stockQty: 10,
      bulkMinimumQty: 5,
      supportsBulkOrder: true,
      deliveryPartner: 'klick',
      isActive: true,
      updatedAt: now,
    },
    {
      id: 'phone-galaxy-a55-128',
      brand: 'Samsung',
      category: 'samsung_galaxy',
      model: 'Galaxy A55 5G',
      exactModelNumber: 'SM-A556B/DS',
      regionalVariant: 'Regional Variant (CSC Check Recommended)',
      storage: '128 GB',
      condition: 'Verified Business Stock',
      warrantySummary: '6-Month Commercial Stock Warranty',
      esimCapable: true,
      esimCompatibilityStatus: 'needs_verification',
      networkUnlockStatus: 'verified_unlocked',
      ethioTelecomCompatibility: 'unverified',
      safaricomCompatibility: 'unverified',
      compatibilityNotes:
        'Certain Galaxy A55 regional firmwares disable eSIM in SIM Manager. Yene Tele technicians verify *#06# EID on each unit before dispatch.',
      compatibilityEvidence: null,
      imageKey: 'galaxy-a55',
      imageUrl: null,
      isFeatured: false,
      unitPriceEtb: null,
      sandboxPreviewPriceEtb: 39500,
      pricingStatus: 'pending_commercial_quote',
      stockQty: 15,
      bulkMinimumQty: 10,
      supportsBulkOrder: true,
      deliveryPartner: 'klick',
      isActive: true,
      updatedAt: now,
    },
    {
      id: 'phone-iphone-15-cn-128',
      brand: 'Apple',
      category: 'iphone',
      model: 'iPhone 15 (Dual Physical SIM Edition)',
      exactModelNumber: 'A3092',
      regionalVariant: 'Mainland China Variant (No Hardware eSIM)',
      storage: '128 GB',
      condition: 'Open Box · Inspected',
      warrantySummary: '6-Month Supplier Hardware Warranty',
      esimCapable: false,
      esimCompatibilityStatus: 'not_compatible',
      networkUnlockStatus: 'verified_unlocked',
      ethioTelecomCompatibility: 'not_compatible',
      safaricomCompatibility: 'not_compatible',
      compatibilityNotes:
        'This A3092 Mainland China hardware variant uses two physical Nano-SIM slots and has no embedded eSIM chip. Suitable for physical SIM use only.',
      compatibilityEvidence: 'Apple A3092 hardware specification omits eSIM EID module.',
      imageKey: 'iphone-15',
      imageUrl: null,
      isFeatured: false,
      unitPriceEtb: null,
      sandboxPreviewPriceEtb: 79000,
      pricingStatus: 'pending_commercial_quote',
      stockQty: 3,
      bulkMinimumQty: 5,
      supportsBulkOrder: false,
      deliveryPartner: 'klick',
      isActive: true,
      updatedAt: now,
    },
  ];
}
