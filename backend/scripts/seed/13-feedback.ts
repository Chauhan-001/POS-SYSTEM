/**
 * 13-feedback.ts — Creates 400+ feedback records with realistic rating distribution and natural language.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, CustomerSeedResult, oid } from './types';
import { daysAgo, rand, pick, randomPhone } from './helpers';

const FEEDBACK_TEMPLATES: Record<number, string[]> = {
  5: [
    'Absolutely fantastic food! The paneer kadhai was the best I\'ve had in Lucknow.',
    'Amazing experience. Staff was very polite and the food was served hot.',
    'Perfect dinner! The butter chicken was heavenly. Will definitely come back.',
    'Great ambience, great food. The biryani was cooked to perfection.',
    'Loved the cold coffee! One of the best in the city. Highly recommend.',
    'Outstanding service! Our waiter was very attentive. Food was top-notch.',
    'The lunch thali was amazing value. Every dish was perfectly cooked.',
    'Celebrated my anniversary here. Beautiful setup and delicious food!',
    'Family loved the dinner. Especially the dal makhani and garlic naan.',
    'Best restaurant in Hazratganj! The quality is always consistent.',
    'Tried the burger combo - totally worth it! Great portions.',
    'The weekend special offer was great. Good food at a good price.',
    'Everything was perfect from start to finish. 10/10 experience.',
    'The chef really knows what he\'s doing. Authentic North Indian flavors.',
    'Loved the kulfi! Such a perfect ending to a great meal.',
  ],
  4: [
    'Very good food overall. The naan could have been a bit more fluffy.',
    'Nice restaurant, good portions. Service was slightly slow during rush hour.',
    'Enjoyed the meal. Paneer tikka was excellent. Soup took a while though.',
    'Good food, fair prices. Would prefer slightly bigger portions.',
    'Really liked the ambience. Food was good but not great. Still recommended.',
    'Decent experience. The biryani was good, raita could be better.',
    'Good place for family dinner. The kids loved the chocolate brownie.',
    'Tried the hakka noodles - quite good. Will try other dishes next time.',
    'Solid 4/5. Food quality is consistently good. Minor delay in service.',
    'Nice place, good food. The pricing is reasonable for the quality.',
    'Great lunch experience. The thali is a great deal. Will return.',
    'Really enjoyed the butter chicken. Naan was good too.',
    'The veg manchurian was quite tasty. Good for vegetarians.',
    'Good restaurant. The offers/coupons are a nice bonus.',
    'Consistent quality. Been here 3 times and never disappointed.',
  ],
  3: [
    'Food was decent but nothing special. Expected more from the price.',
    'Average experience. The paneer was a bit overcooked. Service was okay.',
    'It was fine. Nothing to complain about but nothing to rave about either.',
    'The food was okay. Waited 25 minutes for the main course which was too long.',
    'Decent food but the restaurant was too noisy. Hard to have a conversation.',
    'Mixed feelings. The starter was great but the main course was mediocre.',
    'The biryani was good but the raita was too watery. Expected better.',
    'Average taste. For the price I expected more. The pizza was okay.',
    'Food took a while to arrive. When it came it was decent but not hot enough.',
    'The cold coffee was good but the food was just okay. Nothing special.',
    'Decent experience. The ambience is nice but food needs improvement.',
    'It was alright. The portion sizes could be bigger for the price.',
    'Expected better quality for a restaurant at this price point.',
    'The thali was okay. Some items were good, some were average.',
    'Food quality varies. Sometimes it\'s great, sometimes just average.',
  ],
  2: [
    'Disappointed with the food quality. The paneer kadhai was too oily.',
    'Service was very slow. Had to wait 30 minutes even though the place wasn\'t busy.',
    'The food was cold when it arrived. Had to send it back to be reheated.',
    'Expected much better. The biryani was undercooked and the raita was stale.',
    'Not worth the price. Small portions and average taste.',
    'The restaurant was dirty and the tables weren\'t cleaned properly.',
    'Waiter was rude when we asked for water. Food was below average.',
    'Very disappointed. Ordered butter chicken but received a watered-down version.',
    'The pizza was burnt and the fries were cold. Had to complain.',
    'Overpriced for the quality. The food at the local dhaba is better.',
  ],
  1: [
    'Terrible experience. Found a hair in my food. Won\'t be coming back.',
    'Absolutely awful. The food was inedible and the staff was unhelpful.',
    'Worst dining experience ever. Cold food, rude staff, dirty tables.',
    'Food poisoning after eating here. Stay away from this place.',
  ],
};

export async function seedFeedback(db: Db, ctx: SeedContext, customersCtx: CustomerSeedResult): Promise<void> {
  console.log('💬 Seeding feedback...');
  const rid = ctx.restaurantId;
  let count = 0;

  // Rating distribution: 5★=45%, 4★=30%, 3★=15%, 2★=7%, 1★=3%
  const ratingWeights = [
    { rating: 5, weight: 0.45 },
    { rating: 4, weight: 0.30 },
    { rating: 3, weight: 0.15 },
    { rating: 2, weight: 0.07 },
    { rating: 1, weight: 0.03 },
  ];

  function pickRating(): number {
    const r = Math.random();
    let cumulative = 0;
    for (const w of ratingWeights) {
      cumulative += w.weight;
      if (r <= cumulative) return w.rating;
    }
    return 5;
  }

  const FEEDBACK_CATEGORIES = ['Food Quality', 'Service', 'Ambience', 'Value', 'Packaging', 'Speed', 'Staff Behavior'];

  for (let day = 90; day >= 0; day--) {
    const d = daysAgo(day);
    const feedbackPerDay = day <= 3 ? rand(3, 6) : day <= 7 ? rand(2, 5) : rand(1, 4);

    for (let i = 0; i < feedbackPerDay; i++) {
      const rating = pickRating();
      const comment = pick(FEEDBACK_TEMPLATES[rating]);
      const customerIdx = rand(0, customersCtx.customerIds.length - 1);
      const customerId = customersCtx.customerIds[customerIdx];
      const customer = await db.collection('customers').findOne({ _id: customerId });

      await db.collection('receiptfeedbacks').insertOne({
        _id: oid(), restaurantId: rid, branchId: pick(ctx.branchIds),
        customerId, customerPhone: customer?.phone || randomPhone(),
        customerName: customer?.name || 'Customer',
        rating, comment, category: pick(FEEDBACK_CATEGORIES),
        source: pick(['receipt_qr', 'website', 'app']),
        isRead: Math.random() < 0.6,
        createdAt: d, updatedAt: d,
      });
      count++;
    }
  }

  console.log(`   ✅ Feedback: ${count}`);
}
