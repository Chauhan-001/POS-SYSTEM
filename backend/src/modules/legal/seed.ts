/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * legalSeed — idempotent seeding of DRAFT legal documents.
 *
 * IMPORTANT:
 *  - All documents are created with status 'draft' and version '0.1' and a
 *    visible "DRAFT — requires legal review" marker. Nothing here is presented
 *    to end users as an active legal document until an authorized admin
 *    publishes it from the admin dashboard.
 *  - The text describes ONLY functionality that exists in this codebase and
 *    deliberately avoids unsupported compliance claims.
 *  - These drafts MUST be reviewed by a qualified lawyer before publication.
 */

import mongoose from 'mongoose';
import LegalDocument, { LegalDocumentType } from './models/LegalDocument';

interface DraftInput {
  documentType: LegalDocumentType;
  title: string;
  content: string;
  requireAcceptance: boolean;
  reAcceptanceRequired: boolean;
}

/** Published version of a seeded document: the rewritten body + sections with
 *  the draft scaffolding (DRAFT marker, "areas requiring legal review"
 *  placeholder) stripped — i.e. what an admin would actually publish. */
export function toPublishedContent(content: string): string {
  return content
    .replace(DRAFT_MARKER, '')
    .split('\n\n## Areas requiring legal review\n\n')[0]
    .trim();
}

const DRAFT_MARKER =
  '[DRAFT FOR REVIEW — This document has not been finalised or published. It must be reviewed by a qualified lawyer before use. It is not an active legal agreement.]\n\n';

function buildContent(body: string, sections: Array<{ heading: string; text: string }>): string {
  return (
    DRAFT_MARKER +
    body +
    '\n\n' +
    sections.map((s) => `## ${s.heading}\n\n${s.text}`).join('\n\n') +
    '\n\n## Areas requiring legal review\n\n' +
    'This document is a technical draft. Before publication, a qualified lawyer must confirm: (a) the exact legal entity name and registered address; (b) applicable jurisdictions and governing law; (c) data-controller/data-processor roles between the platform and restaurants; (d) retention periods consistent with applicable law; (e) grievance/contact obligations; (f) consumer and electronic-contract requirements; and (g) any jurisdiction-specific disclosures.'
  );
}

export const DRAFTS: DraftInput[] = [
  {
    documentType: 'terms_of_service',
    title: 'Terms of Service',
    requireAcceptance: true,
    reAcceptanceRequired: true,
    content: buildContent(
      'These Terms of Service ("Terms") govern your use of the restaurant management platform operated by [PLATFORM LEGAL ENTITY NAME — to be confirmed] ("Platform", "we", "us"). By creating an account and using the Platform you agree to these Terms.',
      [
        { heading: '1. The Service', text: 'The Platform provides restaurant POS, billing, kitchen display, ordering (in-person, table QR and customer website), menu configuration (variants, customizations and add-ons), inventory and recipe management, loyalty, offers, reporting, AI-assisted features and related tools ("Service"). We may add, change or remove features from time to time.' },
        { heading: '2. Offline operation and sync', text: 'The Service is designed to continue operating when a device loses internet connectivity. Orders, bills and inventory events created offline are stored on the device and synchronised with the platform when connectivity is restored. Each offline transaction carries a unique client transaction identifier and the platform processes each transaction at most once; the platform does not silently rewrite the amounts of a completed offline transaction based on later menu or pricing changes. You remain responsible for the accuracy of transactions you create, whether online or offline.' },
        { heading: '3. Accounts', text: 'You must provide accurate account information and keep your credentials confidential. You are responsible for activity under your account. We may suspend or terminate accounts that violate these Terms or applicable law.' },
        { heading: '4. Acceptable use', text: 'You agree not to misuse the Service, attempt to access another tenant\u2019s data, interfere with the Service, or use it in violation of applicable law. See the Acceptable Use Policy.' },
        { heading: '5. Fees and payment', text: 'Subscription fees, billing periods, renewal, cancellation and refund handling are described on the plan you select and in the applicable order. Payment is processed by our payment provider; we do not store full card numbers on our servers.' },
        { heading: '6. Your data', text: 'You retain ownership of the data you enter. We process data to provide the Service as described in the Privacy Policy and the Data Processing terms. We apply reasonable technical and organisational security measures. For offline operation, a copy of the data needed to run the terminal (menu catalog, prices, configuration, tax and offline-safe offer rules) is stored on your device and updated when connectivity is available.' },
        { heading: '7. AI features', text: 'Certain features use third-party AI providers. Data sent to AI providers is limited to what is necessary for the requested feature, as described in the AI & Voice Data Disclosure. AI output is generated and may be inaccurate; you remain responsible for decisions made using it.' },
        { heading: '8. Termination', text: 'You may stop using the Service and close your account at any time. Sections that by their nature survive termination (fees, indemnities, limitations of liability, governing law) will survive. Historical transaction records are retained in accordance with applicable law.' },
        { heading: '9. Disclaimers and limitation of liability', text: 'THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, TO THE MAXIMUM EXTENT PERMITTED BY LAW. OUR TOTAL LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE IS LIMITED TO THE AMOUNT YOU PAID US IN THE 3 MONTHS PRECEDING THE CLAIM, OR AS OTHERWISE REQUIRED BY LAW. NOTHING HERE EXCLUDES LIABILITY THAT CANNOT BE EXCLUDED UNDER APPLICABLE LAW.' },
        { heading: '10. Governing law and disputes', text: '[GOVERNING LAW / JURISDICTION — to be confirmed by lawyer.] These Terms are governed by the laws of [JURISDICTION]. Disputes will be subject to the exclusive jurisdiction of the courts at [VENUE].' },
        { heading: '11. Changes to these Terms', text: 'We may update these Terms. If a change is material, we will notify you and, where required, ask you to accept the new version before continued use. The version you accepted remains on record.' },
      ],
    ),
  },
  {
    documentType: 'privacy_policy',
    title: 'Privacy Policy',
    requireAcceptance: true,
    reAcceptanceRequired: true,
    content: buildContent(
      'This Privacy Policy describes how [PLATFORM LEGAL ENTITY NAME — to be confirmed] ("we", "us") collects, uses, stores and shares personal information through the Platform, and the controls available to you.',
      [
        { heading: '1. Information we collect', text: 'We collect: (a) account information you provide (name, phone, email, restaurant details); (b) business data you enter (menu items, orders, customers, inventory); (c) customer information entered when serving customers (e.g. name, phone for orders/loyalty); (d) technical information such as IP address, device identifiers, browser and usage logs for security and operations; (e) voice/audio where you use voice-enabled inventory features, as described in the AI & Voice Data Disclosure.' },
        { heading: '2. How we use information', text: 'We use information to provide and operate the Service, process orders and payments, support loyalty/offers, secure the platform, comply with legal obligations, and — only with separate consent — send marketing communications.' },
        { heading: '3. Sharing', text: 'We share information only as needed: with hosting and infrastructure providers, payment processors for billing, AI providers for AI features (minimised data), and where required by law. We do not sell personal information. A current third-party list is available in the platform documentation.' },
        { heading: '4. Tenant isolation', text: 'Restaurants are separate tenants. Data entered by one restaurant is not accessible to other restaurants. Access is controlled server-side.' },
        { heading: '5. Offline operation and device data', text: 'The platform\u2019s POS software may store a local copy of data needed to operate (menu catalog, prices, configuration, tax and offline-safe offer rules) on the device, and may store orders, bills and inventory events locally when the device is offline until they synchronise to the platform. You should secure devices that hold such data and limit access to authorised staff.' },
        { heading: '6. Retention', text: 'We retain personal information only as long as needed for the purposes described, and to meet legal, tax and accounting obligations. Voice/audio is retained only as described in the AI & Voice Data Disclosure. Completed transaction records (including offline-created transactions after sync) are retained as business records in accordance with applicable law.' },
        { heading: '7. Your choices', text: 'Through the platform you can export data, request account closure, withdraw optional marketing/communications consent, and request correction of your profile data. These requests are logged and processed by the platform.' },
        { heading: '8. Security', text: 'We apply reasonable administrative, technical and physical safeguards, including encryption in transit, hashed credentials and access controls. No security measure is infallible.' },
        { heading: '9. Children', text: 'The Service is intended for businesses, not children. We do not knowingly collect personal information from children. [CONFIRM WITH LAWYER whether any age-specific requirements apply.]' },
        { heading: '10. Contact and grievance', text: 'For privacy questions or requests, contact us at [CONTACT EMAIL — to be confirmed]. We will respond within the time required by applicable law. [GRIEVANCE OFFICER DETAILS — to be confirmed if required.]' },
        { heading: '11. Changes', text: 'We may update this Privacy Policy. Material changes will be notified and, where required, presented for acknowledgement before continued use.' },
      ],
    ),
  },
  {
    documentType: 'merchant_agreement',
    title: 'Restaurant Merchant Agreement',
    requireAcceptance: true,
    reAcceptanceRequired: true,
    content: buildContent(
      'This Restaurant Merchant Agreement ("Agreement") is between [PLATFORM LEGAL ENTITY NAME — to be confirmed] ("Platform") and the restaurant operating the account ("Restaurant", "you"). It supplements the Terms of Service.',
      [
        { heading: '1. Platform services', text: 'The Platform provides POS, ordering (in-person, table QR and customer website), billing, kitchen display, menu configuration, inventory and recipe management, loyalty, offers, reporting and related services to the Restaurant.' },
        { heading: '2. Restaurant responsibilities', text: 'You are responsible for the accuracy of menu/pricing data, compliance with food-safety and consumer laws applicable to your business, tax collection and remittance (e.g. GST where applicable), and lawful processing of your customers\u2019 data. You are also responsible for the accuracy of transactions created while operating offline and for settling or rectifying them in accordance with applicable law.' },
        { heading: '3. Customer data', text: 'You are the controller (or are otherwise responsible under applicable law) for customer data you enter. The Platform processes it on your behalf as described in the Data Processing terms and Privacy Policy. You must comply with applicable privacy law when collecting customer data (e.g. informing customers about your practices).' },
        { heading: '4. Fees', text: 'Subscription fees are as selected at sign-up. [CONFIRM: commission/facilitation fees, if any, for online orders.] Payment failures may suspend service per the subscription terms.' },
        { heading: '5. Term and termination', text: 'This Agreement continues while your account is active. Either party may terminate per the Terms. Upon termination, the Restaurant may export its data during a transition period defined by the Platform; business records (including offline-created transactions after sync) are retained per applicable law.' },
      ],
    ),
  },
  {
    documentType: 'customer_terms',
    title: 'Customer Terms & Conditions (Online Ordering)',
    requireAcceptance: false,
    reAcceptanceRequired: false,
    content: buildContent(
      'These Customer Terms apply when you place an order through a restaurant\u2019s online ordering page powered by the Platform. The restaurant you order from is the merchant for your order.',
      [
        { heading: '1. Ordering', text: 'When you place an order you confirm the items, quantities and price shown at checkout. Items may have configuration choices (size, customizations, add-ons) that affect the price; the final price is calculated by the restaurant\u2019s system using the same pricing rules as its POS. Order confirmation does not guarantee availability; the restaurant may contact you about unavailable items.' },
        { heading: '2. Tables and QR ordering', text: 'A table with an existing open order is not available for a new order from its QR code. If a table is already occupied, you will be asked to speak with your server to add items to the existing order.' },
        { heading: '3. Payment', text: 'Payment is processed through the restaurant\u2019s payment provider. Prices include applicable taxes unless stated otherwise. [CONFIRM tax display rules with lawyer.]' },
        { heading: '4. Cancellation and refunds', text: 'Cancellation and refund eligibility are governed by the restaurant\u2019s policies and applicable consumer law. Contact the restaurant for order issues. See the Refund & Cancellation Policy.' },
        { heading: '5. Your information', text: 'When you provide your name, phone number or other details, the restaurant uses them to fulfil your order. See the restaurant\u2019s privacy practices and the platform Privacy Policy.' },
        { heading: '6. Food safety', text: 'The restaurant is responsible for the preparation, quality and safety of the food. Please report any concerns to the restaurant directly.' },
      ],
    ),
  },
  {
    documentType: 'refund_policy',
    title: 'Refund & Cancellation Policy',
    requireAcceptance: false,
    reAcceptanceRequired: false,
    content: buildContent(
      'This policy explains refund and cancellation handling for payments processed through the Platform.',
      [
        { heading: '1. Order cancellations', text: 'Order cancellation rules are set by the restaurant and applicable consumer law. If an order cannot be fulfilled, the restaurant should arrange a refund through the payment method used.' },
        { heading: '2. Subscription refunds', text: '[CONFIRM WITH LAWYER/BUSINESS: refund windows for subscription fees, pro-rata treatment on cancellation, and trial-period terms.]' },
        { heading: '3. How refunds are issued', text: 'Refunds are issued to the original payment method through the payment provider. Timing depends on the provider and the customer\u2019s bank.' },
        { heading: '4. Disputes', text: 'If you believe a refund is owed, contact the restaurant (for orders) or the platform (for subscription fees) first. Nothing in this policy limits rights you have under applicable consumer law.' },
      ],
    ),
  },
  {
    documentType: 'ai_voice_disclosure',
    title: 'AI & Voice Data Disclosure',
    requireAcceptance: true,
    reAcceptanceRequired: true,
    content: buildContent(
      'This disclosure explains how AI-assisted and voice features process data. These features are optional and configurable.',
      [
        { heading: '1. AI-assisted features', text: 'The Platform includes AI features such as sales summaries, inventory health and purchase recommendations, weather-based suggestions, and assistant answers. When used, relevant business data (menu/sales/inventory summaries) is sent to third-party AI providers configured by the Platform. We minimise data sent to what is needed for the feature.' },
        { heading: '2. Voice inventory entry', text: 'Where enabled, voice entry captures audio via your device\u2019s microphone after you grant permission through your browser/OS. Audio is sent to a speech-to-text provider to transcribe your spoken command. The transcription is parsed into an inventory command (e.g. item, quantity).' },
        { heading: '3. Retention', text: 'Raw audio is not stored by the Platform beyond what is needed for transcription, unless retention is separately enabled in your settings. Transcriptions and parsed commands may be stored as part of your business records.' },
        { heading: '4. Providers', text: 'AI and speech-to-text requests are processed by third-party providers. Data sent to them may be processed according to their terms. [CONFIRM with lawyer: provider retention/training settings and required disclosures.]' },
        { heading: '5. Accuracy', text: 'AI and voice output may be inaccurate. You are responsible for verifying AI/voice output before acting on it (e.g. inventory counts).' },
      ],
    ),
  },
  {
    documentType: 'acceptable_use',
    title: 'Acceptable Use Policy',
    requireAcceptance: true,
    reAcceptanceRequired: true,
    content: buildContent(
      'This Acceptable Use Policy sets out what you may not do with the Platform.',
      [
        { heading: '1. Prohibited conduct', text: 'You may not: attempt to access another tenant\u2019s data; probe, scan or test the security of the Service without authorisation; use the Service to store or transmit unlawful content; resell the Service without our consent; interfere with the Service\u2019s operation; or use the Service in violation of applicable law (including privacy, consumer-protection and anti-spam law).' },
        { heading: '2. Security obligations', text: 'You must keep credentials confidential, promptly report suspected unauthorised access, and not attempt to bypass rate limits, access controls or other security measures.' },
        { heading: '3. Enforcement', text: 'We may suspend or terminate accounts that violate this policy, and cooperate with law enforcement as required by law.' },
      ],
    ),
  },
  {
    documentType: 'data_processing_addendum',
    title: 'Data Processing Addendum',
    requireAcceptance: false,
    reAcceptanceRequired: false,
    content: buildContent(
      'This Data Processing Addendum ("DPA") describes how the Platform processes personal data on behalf of restaurants.',
      [
        { heading: '1. Roles', text: 'The Restaurant is responsible for the personal data it enters (customers, staff). The Platform processes that data to provide the Service. [CONFIRM with lawyer: controller/processor role classification under applicable law, including for online ordering where both the restaurant and platform interact with customers.]' },
        { heading: '2. Processing activities', text: 'The Platform processes personal data to operate the Service: order fulfilment, billing, loyalty/offers, support, security and legal compliance.' },
        { heading: '3. Sub-processors', text: 'The Platform may engage sub-processors (e.g. hosting, AI providers, payment processors) as described in the third-party inventory. [CONFIRM: notification mechanism for sub-processor changes.]' },
        { heading: '4. Security', text: 'The Platform applies reasonable technical and organisational measures, including encryption in transit and access controls.' },
        { heading: '5. Data subject requests', text: 'The Platform provides tools (export, correction, closure requests) and will reasonably assist restaurants in responding to data-subject requests they receive.' },
        { heading: '6. Deletion', text: 'Business records (orders, invoices, audit logs) are retained per applicable legal/accounting obligations; personal data handling on account closure follows the documented policy. [CONFIRM exact retention schedule with lawyer.]' },
      ],
    ),
  },
];

export async function seedLegalDocuments(): Promise<number> {
  const existing = await LegalDocument.countDocuments().exec();
  if (existing > 0) {
    return 0; // Never overwrite or duplicate on restart.
  }

  const now = new Date();
  const docs = DRAFTS.map((d) => ({
    ...d,
    version: '0.1',
    status: 'draft',
    publishedAt: null,
    effectiveAt: now,
    jurisdiction: 'IN',
    language: 'en',
    adminNotes: 'Automated seed draft. Requires legal review before publication.',
  }));

  await LegalDocument.insertMany(docs);
  return docs.length;
}
