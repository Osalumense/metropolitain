"use client";

import { useEffect } from "react";
import type { ThemePalette } from "@/lib/theme";

interface LegalModalProps {
  open: boolean;
  onClose: () => void;
  lang: "en" | "fr";
  palette: ThemePalette;
  panelBgSolid: string;
}

const LegalModal = ({
  open,
  onClose,
  lang,
  palette,
  panelBgSolid,
}: LegalModalProps) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isEn = lang === "en";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(620px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          background: panelBgSolid,
          border: `1px solid ${palette.bronze}`,
          borderRadius: 4,
          padding: 24,
          boxSizing: "border-box",
          color: palette.ink,
          fontFamily: "system-ui, sans-serif",
          boxShadow: "0 12px 36px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: `1px solid ${palette.bronze}`,
            paddingBottom: 12,
            marginBottom: 16,
            flexShrink: 0,
          }}
        >
          <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: palette.ink }}>
            {isEn ? "Legal Notice & Credits" : "Mentions Légales & Crédits"}
          </div>
          <button
            onClick={onClose}
            aria-label={isEn ? "Close" : "Fermer"}
            style={{
              background: "none",
              border: "none",
              color: palette.ink,
              fontSize: 22,
              cursor: "pointer",
              lineHeight: 1,
              padding: "4px 8px",
              opacity: 0.7,
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            overflowY: "auto",
            fontSize: 12,
            lineHeight: 1.6,
            paddingRight: 6,
            opacity: 0.9,
          }}
        >
          {/* Section 1: Publisher */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: palette.amberLamp }}>
              {isEn ? "1. Website Publisher" : "1. Éditeur du site"}
            </div>
            <div>
              {isEn ? (
                <>
                  The website <strong style={{ color: palette.ink }}>metropolitain.live</strong> is an independent open-source project published by:
                  <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                    <li><strong>Publisher:</strong> Stephen Akugbe</li>
                    <li>
                      <strong>Contact:</strong>{" "}
                      <a
                        href="mailto:akugbestephen3@gmail.com"
                        style={{ color: palette.amberLamp, textDecoration: "underline" }}
                      >
                        akugbestephen3@gmail.com
                      </a>
                    </li>
                    <li>
                      <strong>Source Code:</strong>{" "}
                      <a
                        href="https://github.com/Osalumense/metropolitain"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: palette.amberLamp, textDecoration: "underline" }}
                      >
                        github.com/Osalumense/metropolitain
                      </a>
                    </li>
                  </ul>
                </>
              ) : (
                <>
                  Le site internet <strong style={{ color: palette.ink }}>metropolitain.live</strong> est un projet open-source indépendant édité par :
                  <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                    <li><strong>Éditeur :</strong> Stephen Akugbe</li>
                    <li>
                      <strong>Contact :</strong>{" "}
                      <a
                        href="mailto:akugbestephen3@gmail.com"
                        style={{ color: palette.amberLamp, textDecoration: "underline" }}
                      >
                        akugbestephen3@gmail.com
                      </a>
                    </li>
                    <li>
                      <strong>Code source :</strong>{" "}
                      <a
                        href="https://github.com/Osalumense/metropolitain"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: palette.amberLamp, textDecoration: "underline" }}
                      >
                        github.com/Osalumense/metropolitain
                      </a>
                    </li>
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* Section 2: Hosting */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: palette.amberLamp }}>
              {isEn ? "2. Web Hosting" : "2. Hébergement"}
            </div>
            <div>
              {isEn ? (
                <>
                  The site and API services are hosted on a Virtual Private Server (VPS) provided by:
                  <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                    <li><strong>Host:</strong> Hetzner Online GmbH</li>
                    <li><strong>Address:</strong> Industriestr. 25, 91710 Gunzenhausen, Germany</li>
                    <li>
                      <strong>Website:</strong>{" "}
                      <a
                        href="https://www.hetzner.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: palette.amberLamp, textDecoration: "underline" }}
                      >
                        hetzner.com
                      </a>
                    </li>
                  </ul>
                </>
              ) : (
                <>
                  Le site et ses services d'API sont hébergés sur un serveur privé virtuel (VPS) fourni par :
                  <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                    <li><strong>Hébergeur :</strong> Hetzner Online GmbH</li>
                    <li><strong>Adresse :</strong> Industriestr. 25, 91710 Gunzenhausen, Allemagne</li>
                    <li>
                      <strong>Site web :</strong>{" "}
                      <a
                        href="https://www.hetzner.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: palette.amberLamp, textDecoration: "underline" }}
                      >
                        hetzner.com
                      </a>
                    </li>
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* Section 3: Data Sources & Intellectual Property */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: palette.amberLamp }}>
              {isEn ? "3. Data Sources & Intellectual Property" : "3. Sources des données et Propriété intellectuelle"}
            </div>
            <div>
              {isEn ? (
                <>
                  <p style={{ margin: "4px 0 8px 0" }}>
                    <strong>Transit Data:</strong> Real-time vehicle stop estimations, network geometries, and service disruption messages are provided by{" "}
                    <a
                      href="https://www.iledefrance-mobilites.fr"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      Île-de-France Mobilités
                    </a>{" "}
                    via their open data platform{" "}
                    <a
                      href="https://prim.iledefrance-mobilites.fr"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      PRIM (Plateforme Régionale d'Information pour la Mobilité)
                    </a>
                    . This public data is reused in accordance with the{" "}
                    <a
                      href="https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      Licence Ouverte v2.0 (Etalab)
                    </a>{" "}
                    and the{" "}
                    <a
                      href="https://opendatacommons.org/licenses/odbl/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      Open Database License (ODbL)
                    </a>
                    .
                  </p>
                  <p style={{ margin: "4px 0 8px 0" }}>
                    <strong>Map & Tiles:</strong> Map rendering is powered by{" "}
                    <a
                      href="https://maplibre.org"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      MapLibre GL JS
                    </a>
                    , vector map tiles hosted by{" "}
                    <a
                      href="https://openfreemap.org"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      OpenFreeMap
                    </a>
                    , and geographical data ©{" "}
                    <a
                      href="https://www.openstreetmap.org/copyright"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      OpenStreetMap contributors
                    </a>
                    .
                  </p>
                  <p style={{ margin: "4px 0 0 0", fontStyle: "italic", opacity: 0.85 }}>
                    <strong>Non-Affiliation Notice:</strong> This website is an independent technical project created for informational and non-commercial purposes. It is not affiliated with, endorsed by, or sponsored by Île-de-France Mobilités, RATP, or SNCF. All transit brand names and line designations are trademarks of their respective owners.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ margin: "4px 0 8px 0" }}>
                    <strong>Données de transport :</strong> Les estimations d'arrêts en temps réel, les tracés du réseau et les bulletins de perturbations sont fournis par{" "}
                    <a
                      href="https://www.iledefrance-mobilites.fr"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      Île-de-France Mobilités
                    </a>{" "}
                    via le portail Open Data{" "}
                    <a
                      href="https://prim.iledefrance-mobilites.fr"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      PRIM (Plateforme Régionale d'Information pour la Mobilité)
                    </a>
                    . Ces données publiques sont réutilisées conformément aux conditions de la{" "}
                    <a
                      href="https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      Licence Ouverte v2.0 (Etalab)
                    </a>{" "}
                    et de l'
                    <a
                      href="https://opendatacommons.org/licenses/odbl/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      Open Database License (ODbL)
                    </a>
                    .
                  </p>
                  <p style={{ margin: "4px 0 8px 0" }}>
                    <strong>Cartographie :</strong> Les rendus cartographiques utilisent{" "}
                    <a
                      href="https://maplibre.org"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      MapLibre GL JS
                    </a>
                    , les tuiles vectorielles hébergées par{" "}
                    <a
                      href="https://openfreemap.org"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      OpenFreeMap
                    </a>{" "}
                    et les données géographiques ©{" "}
                    <a
                      href="https://www.openstreetmap.org/copyright"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: palette.amberLamp, textDecoration: "underline" }}
                    >
                      OpenStreetMap contributors
                    </a>
                    .
                  </p>
                  <p style={{ margin: "4px 0 0 0", fontStyle: "italic", opacity: 0.85 }}>
                    <strong>Avertissement d'indépendance :</strong> Ce site est un projet technique indépendant réalisé à des fins informatives et non-commerciales. Il n'est ni affilié, ni validé, ni sponsorisé par Île-de-France Mobilités, la RATP ou la SNCF. Les noms de lignes, marques et logos cités appartiennent à leurs propriétaires respectifs.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Section 4: Privacy & Cookies */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: palette.amberLamp }}>
              {isEn ? "4. Privacy & Cookies (GDPR)" : "4. Données personnelles et Cookies (RGPD)"}
            </div>
            <div>
              {isEn ? (
                <>
                  <p style={{ margin: "4px 0 6px 0" }}>
                    <strong>Cookies:</strong> This website does not set any advertising, tracking, or profiling cookies on your device. Consequently, no consent banner is required under GDPR and ePrivacy guidelines.
                  </p>
                  <p style={{ margin: "4px 0 6px 0" }}>
                    <strong>Analytics:</strong> Aggregated, cookieless audience metrics are provided through Cloudflare Web Analytics without collecting personal identifiers.
                  </p>
                  <p style={{ margin: "4px 0 0 0" }}>
                    <strong>Server Logs:</strong> For technical stability, operational diagnostics, and server defense, visitor IP addresses are temporarily logged by the web server (Nginx). These logs are not used for any commercial purpose and are automatically purged after standard technical retention periods.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ margin: "4px 0 6px 0" }}>
                    <strong>Cookies :</strong> Ce site ne dépose aucun cookie publicitaire, de traçage ou de profilage sur votre appareil. Aucun bandeau de consentement préalable n'est donc requis selon les recommandations de la CNIL.
                  </p>
                  <p style={{ margin: "4px 0 6px 0" }}>
                    <strong>Mesure d'audience :</strong> Une mesure anonyme et sans cookies est assurée via Cloudflare Web Analytics, sans collecte de données personnelles identifiables.
                  </p>
                  <p style={{ margin: "4px 0 0 0" }}>
                    <strong>Journaux techniques :</strong> Pour des impératifs de sécurité technique et de protection du serveur, les adresses IP des requêtes sont temporairement enregistrées dans les journaux du serveur web (Nginx). Ces données ne sont exploitées à aucune fin commerciale et sont automatiquement effacées à l'issue de leur durée de conservation technique.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer close button */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, paddingTop: 12, borderTop: `1px solid ${palette.bronze}` }}>
          <button
            onClick={onClose}
            style={{
              background: palette.amberLamp,
              color: palette.ground,
              border: "none",
              borderRadius: 2,
              padding: "6px 16px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {isEn ? "Close" : "Fermer"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LegalModal;
