import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode } from 'lucide-react';

export function QrCodeDisplay({
  payload,
  isSandboxSimulation,
  size = 160,
}: {
  payload: string;
  isSandboxSimulation: boolean;
  size?: number;
}) {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: size * 2,
      color: {
        dark: '#0A2DB8',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setSvgMarkup(url);
      })
      .catch(() => {
        if (active) setSvgMarkup(null);
      });
    return () => {
      active = false;
    };
  }, [payload, size]);

  return (
    <div className="flex flex-col items-center text-center space-y-2.5">
      <div
        className="rounded-xl bg-white border border-[#C7D6FE] dark:border-[#2B4C8C] p-3 flex items-center justify-center shadow-xs"
        style={{ width: size + 24, height: size + 24 }}
      >
        {svgMarkup ? (
          <img
            src={svgMarkup}
            alt="eSIM activation QR code"
            width={size}
            height={size}
            className="block rounded"
          />
        ) : (
          <QrCode className="h-16 w-16 text-[#0A2DB8]" />
        )}
      </div>
      <p className="text-[11px] font-semibold tracking-wide text-[#0A2DB8] dark:text-[#93C5FD] max-w-xs">
        {isSandboxSimulation ? 'eSIM Activation QR Code' : 'Authorized eSIM Activation QR Code'}
      </p>
    </div>
  );
}
