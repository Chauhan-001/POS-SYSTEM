/**
 * 11-campaigns.ts — Creates 18 campaigns with realistic marketing data.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, oid } from './types';
import { daysAgo, rand, pick, dateStr } from './helpers';

export async function seedCampaigns(db: Db, ctx: SeedContext): Promise<void> {
  console.log('📢 Seeding campaigns...');
  const rid = ctx.restaurantId;

  // Get offer IDs
  const offers = await db.collection('offers').find({ restaurantId: rid }).toArray();
  if (offers.length === 0) { console.log('   ⚠️  No offers found'); return; }

  const CAMPAIGNS = [
    { title: 'Weekend Special Blast', offerIdx: 0, status: 'active', channels: ['whatsapp', 'sms'], message: '🍽️ Weekend Special! 15% off main course at The Royal Bistro. Use code WEEKEND15. Valid Sat-Sun only!', language: 'en', style: 'promotional' },
    { title: 'Lunch Deal Push', offerIdx: 1, status: 'active', channels: ['whatsapp'], message: '🍛 Lunch Thali at ₹50 OFF! Use LUNCH50 at checkout. Valid 12-3 PM daily.', language: 'en', style: 'friendly' },
    { title: 'Flat ₹100 Off Campaign', offerIdx: 2, status: 'active', channels: ['whatsapp', 'sms', 'email'], message: '💰 ₹100 OFF on orders above ₹500! Use code FLAT100. Limited time only!', language: 'en', style: 'promotional' },
    { title: 'Free Dessert Promo', offerIdx: 3, status: 'active', channels: ['whatsapp'], message: '🍰 Free Gulab Jamun on orders above ₹799! Show this message to claim. 🎉', language: 'en', style: 'funky' },
    { title: 'Cashback Campaign', offerIdx: 4, status: 'active', channels: ['sms', 'email'], message: '💸 10% cashback up to ₹150 on your next visit! Code: CASH10. Don\'t miss out!', language: 'en', style: 'promotional' },
    { title: 'Happy Hours Blast', offerIdx: 5, status: 'active', channels: ['whatsapp'], message: '🍹 Happy Hours 3-6 PM! 20% off all beverages. Grab your cold drinks now! Code: HAPPY20', language: 'en', style: 'funky' },
    { title: 'Diwali Campaign', offerIdx: 9, status: 'expired', channels: ['whatsapp', 'sms', 'email'], message: '🪔 Diwali Dhamaka! ₹150 off festive orders. Code: DIWALI150. Happy Diwali from Royal Bistro! 🎆', language: 'hinglish', style: 'festive' },
    { title: 'Monsoon Special', offerIdx: 11, status: 'paused', channels: ['whatsapp'], message: '🌧️ Monsoon Special! ₹75 off soup + main course combo. Stay warm with our hot soups! Code: MONSOON75', language: 'en', style: 'friendly' },
    { title: 'New Year Mega', offerIdx: 8, status: 'expired', channels: ['whatsapp', 'sms'], message: '🎉 New Year 25% OFF entire menu! Start the year with great food! Code: NEWYEAR25', language: 'en', style: 'promotional' },
    { title: 'Student Discount Push', offerIdx: 15, status: 'active', channels: ['whatsapp', 'sms'], message: '🎓 Students! Show your ID and get 12% OFF at Royal Bistro. Code: STUDENT12. Valid all week!', language: 'en', style: 'funky' },
    { title: 'Welcome Campaign', offerIdx: 17, status: 'active', channels: ['whatsapp', 'email'], message: '👋 Welcome to Royal Bistro! Enjoy 20% OFF on your first order. Code: WELCOME20. We\'re glad you\'re here! 🍽️', language: 'en', style: 'friendly' },
    { title: 'Referral Drive', offerIdx: 18, status: 'active', channels: ['whatsapp'], message: '👥 Refer a friend and both get ₹100 OFF! Share your love for good food. Code: REFER100', language: 'en', style: 'promotional' },
    { title: 'Combo Launch', offerIdx: 19, status: 'active', channels: ['whatsapp', 'sms'], message: '🍔🍕 NEW COMBO: Veg Burger + Coke at just ₹249! Save ₹50. Available now! Code: BURGER249', language: 'en', style: 'promotional' },
    { title: 'Pizza Night Promo', offerIdx: 20, status: 'active', channels: ['whatsapp'], message: '🍕 Pizza Night! ₹80 off any pizza at Royal Bistro. Code: PIZZA80. Perfect for family dinners!', language: 'en', style: 'friendly' },
    { title: 'Night Owl Campaign', offerIdx: 22, status: 'active', channels: ['whatsapp'], message: '🦉 Late night cravings? Get 15% off after 10 PM! Code: NIGHT15. The Royal Bistro is open for you!', language: 'en', style: 'funky' },
    { title: 'Weekend Strategy (Draft)', offerIdx: 0, status: 'draft', channels: ['whatsapp'], message: 'Planning weekend campaign...', language: 'en', style: 'professional' },
    { title: 'Bilingual Hinglish Test', offerIdx: 6, status: 'active', channels: ['whatsapp'], message: '🎂 Birthday hai aapki? ₹200 OFF aapka special din! Code: BDAY200. Royal Bistro mein celebrate karein! 🎉', language: 'hinglish', style: 'funky' },
    { title: 'Eid Preparation', offerIdx: 14, status: 'scheduled', channels: ['whatsapp', 'sms', 'email'], message: '🌙 Eid Mubarak! Flat ₹100 off festive orders. Code: EID100. Celebrate with Royal Bistro! ✨', language: 'en', style: 'festive' },
  ];

  let count = 0;
  for (const c of CAMPAIGNS) {
    const offer = offers[Math.min(c.offerIdx, offers.length - 1)];
    await db.collection('campaigns').insertOne({
      _id: oid(), restaurantId: rid, name: c.title,
      offerId: offer?._id, offerTitle: offer?.title,
      channels: c.channels, status: c.status,
      message: c.message, language: c.language, style: c.style,
      template: { channel: c.channels[0], message: c.message },
      branches: c.status === 'active' ? [] : [ctx.branchIds[0]],
      scheduledAt: c.status === 'scheduled' ? daysAgo(-7) : c.status === 'active' ? daysAgo(rand(5, 60)) : null,
      sentAt: c.status === 'active' ? daysAgo(rand(1, 50)) : null,
      sentCount: c.status === 'active' ? rand(50, 500) : c.status === 'expired' ? rand(200, 800) : 0,
      openCount: 0, clickCount: 0,
      isDeleted: false, createdAt: daysAgo(rand(10, 120)), updatedAt: new Date(),
    });
    count++;
  }

  // ─── Promotions (website creatives) ───────────────────────────
  let promoCount = 0;
  const templateIds = ['hero-banner', 'offer-card', 'square-creative', 'mobile-banner'];
  for (const offer of offers.slice(0, 10)) {
    await db.collection('promotions').insertOne({
      _id: oid(), restaurantId: rid, offerId: offer._id,
      name: `${offer.title} - Website`, templateId: pick(templateIds),
      status: 'published', channels: ['website'],
      creative: {
        title: offer.title,
        subtitle: offer.type === 'percentage' ? `${offer.value}% OFF` : `${offer.value} OFF`,
        description: offer.description || '',
        cta: 'Order Now', language: 'en',
        colors: { background: '#0b2a5b', text: '#ffffff', accent: '#f59e0b' },
        image: null, screenImages: {}, logoKey: null, productImageKeys: [],
        layout: 'hero',
      },
      offerSnapshot: { title: offer.title, type: offer.type, value: offer.value },
      publishedAt: daysAgo(rand(1, 60)),
      isDeleted: false, createdAt: daysAgo(rand(10, 90)), updatedAt: new Date(),
    });
    promoCount++;
  }

  console.log(`   ✅ Campaigns: ${count}`);
  console.log(`   ✅ Promotions: ${promoCount}`);
}
