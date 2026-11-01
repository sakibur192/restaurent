// Default landing page content in English and Bangla. Every field is editable from Super Admin → Landing page.
module.exports = {
  en: {
    hero_badge: 'Restaurant Management System',
    hero_title: 'Run your whole restaurant',
    hero_highlight: 'from one screen',
    hero_sub: 'POS, kitchen display, tables, QR ordering, delivery, inventory, recipe costing, staff and accounts — one simple system for restaurants, cafés, bakeries and cloud kitchens across Bangladesh.',
    cta_primary: 'Start free trial',
    cta_secondary: 'Log in',
    hero_note: 'No installation · Works on mobile, tablet and PC · bKash & Nagad ready',
    stats: [
      { value: '15+', label: 'modules in one package' },
      { value: '27', label: 'ready-made reports' },
      { value: '6', label: 'staff roles with PIN login' },
      { value: '∞', label: 'branches, staff & orders' }
    ],
    problems_title: 'Sound familiar?',
    problems_sub: 'Every restaurant owner faces these problems. Baybex solves each one.',
    problems: [
      { problem: 'Cash never matches at the end of the day', solution: 'Cash shifts calculate exactly how much should be in the drawer — short or extra shows instantly.' },
      { problem: 'Orders get lost, food comes late', solution: 'Orders go straight to the kitchen screen with live timers. Late tickets turn red.' },
      { problem: 'Stock disappears and nobody knows', solution: 'Every sale deducts ingredients by recipe. Expected vs actual usage shows losses in taka.' },
      { problem: 'You don\'t know which dish makes profit', solution: 'Cost, profit and food-cost % for every dish, updated from your purchase prices.' },
      { problem: 'Staff give discounts and cancel bills freely', solution: 'Separate logins, manager PIN for discounts, voids and refunds, and a full activity log.' }
    ],
    modules_title: 'Everything in one package',
    modules_sub: 'No add-ons to buy. Every feature is included for every customer.',
    modules: [
      { icon: '🧾', title: 'POS & billing', text: 'Fast billing for dine-in, takeaway, delivery and drive-thru.', bullets: ['Sizes, add-ons and cooking notes', 'Split bill, merge bills, move table', 'Cash + bKash + Nagad + card on one bill', 'Due (credit) sales with limits', 'Works offline and syncs later'] },
      { icon: '👨‍🍳', title: 'Kitchen display', text: 'Paperless kitchen with stations and live timers.', bullets: ['Grill, drinks, bakery stations', 'Late orders turn orange then red', 'Ready alerts to waiters', 'Priority orders and cancellations'] },
      { icon: '🍽️', title: 'Tables & floor plan', text: 'See every table, its bill and time at a glance.', bullets: ['Free, occupied, reserved, cleaning', 'Assign waiters', 'Print table QR codes in any size'] },
      { icon: '📱', title: 'QR menu & online orders', text: 'Guests order from their own phone — no app needed.', bullets: ['Table QR ordering', 'Pickup and home delivery', '6 beautiful menu themes', 'Live order tracking page'] },
      { icon: '🛵', title: 'Delivery', text: 'Zones, charges and riders on one board.', bullets: ['Zone-based delivery charge', 'Assign riders, track status', 'Cash collected per rider'] },
      { icon: '📦', title: 'Inventory', text: 'Stock that updates itself with every sale.', bullets: ['Low-stock alerts', 'Wastage, expiry and batches', 'Physical count and branch transfer'] },
      { icon: '🧪', title: 'Recipe & food cost', text: 'Know the real cost and profit of every plate.', bullets: ['Cost per portion and food cost %', 'Suggested selling price', 'Recipe version history'] },
      { icon: '🚚', title: 'Purchases & suppliers', text: 'Buy, receive and pay suppliers properly.', bullets: ['Purchase orders and GRN', 'Supplier ledger and dues', 'Price history per ingredient'] },
      { icon: '👥', title: 'Customers & loyalty', text: 'Turn first-time guests into regulars.', bullets: ['Order history and favourites', 'Loyalty points and coupons', 'Birthday reminders, credit limits'] },
      { icon: '🧑‍💼', title: 'Staff & payroll', text: 'Logins, attendance and salary in one place.', bullets: ['Owner, manager, cashier, waiter, chef, accountant', 'Clock in/out, schedules, leave', 'Salary, advance and overtime'] },
      { icon: '💰', title: 'Accounting & VAT', text: 'Your books are written automatically.', bullets: ['Profit & loss, cashbook', 'VAT report with BIN', 'Expenses, dues and period closing'] },
      { icon: '📊', title: 'Reports & multi-branch', text: 'Make decisions with real numbers.', bullets: ['27 reports with Excel export', 'Peak hours and best sellers', 'All branches from one account'] }
    ],
    shots_title: 'See it in action',
    shots: [
      { img: 'pos', caption: 'POS — bill a table in seconds' },
      { img: 'kitchen', caption: 'Kitchen display with live timers' },
      { img: 'tables', caption: 'Live floor plan' },
      { img: 'recipe', caption: 'Recipe cost and profit per dish' },
      { img: 'pnl', caption: 'Profit & loss, automatically' },
      { img: 'delivery', caption: 'Delivery board' }
    ],
    steps_title: 'Start in 4 simple steps',
    steps: [
      { title: 'Create your account', text: 'Sign up in two minutes. A sample menu and tables are added so you can try it right away.' },
      { title: 'Add your menu', text: 'Add items with photos, sizes and add-ons — or upload your whole menu from Excel.' },
      { title: 'Set up tables and staff', text: 'Arrange floors and tables, print QR codes, and give each staff member a login or PIN.' },
      { title: 'Start selling', text: 'Take orders, send them to the kitchen and get paid. Reports update on their own.' }
    ],
    audience_title: 'Made for',
    audience: ['Restaurants', 'Cafés', 'Fast food', 'Biryani houses', 'Bakeries & sweet shops', 'Cloud kitchens', 'Food courts', 'Multi-branch chains'],
    pricing_title: 'Simple pricing',
    pricing_sub: 'One package with every feature. Pay monthly or save with a longer plan.',
    downloads_title: 'Downloads',
    downloads_sub: 'User manual and brochure — read them, share them with your team.',
    faq_title: 'Frequently asked questions',
    faq: [
      { q: 'Do I need to install anything?', a: 'No. It runs in any web browser on PC, laptop, tablet or phone.' },
      { q: 'What if the internet goes down?', a: 'The POS keeps taking paid orders on the device and sends them to the server automatically when the internet returns.' },
      { q: 'Can my staff have separate logins?', a: 'Yes. Owner, manager, cashier, waiter, chef and accountant — each sees only what you allow. Staff can log in with a quick PIN.' },
      { q: 'Does it support bKash, Nagad and VAT?', a: 'Yes. Cash, card, bKash, Nagad, Rocket and due are tracked separately, and VAT and service charge are calculated automatically.' },
      { q: 'Can I use it for more than one branch?', a: 'Yes. Add unlimited branches and see them separately or together.' },
      { q: 'What happens after the free trial?', a: 'Choose a monthly, 3-month, 6-month or yearly plan and pay by bKash or Nagad. All your data stays as it is.' }
    ],
    contact_title: 'Get a free demo',
    contact_text: 'Call us or send a message — we will show you the system live and help you set up your restaurant.',
    footer_text: '© Baybex. All rights reserved.'
  },
  bn: {
    hero_badge: 'রেস্টুরেন্ট ম্যানেজমেন্ট সিস্টেম',
    hero_title: 'আপনার পুরো রেস্টুরেন্ট এখন',
    hero_highlight: 'এক স্ক্রিনে',
    hero_sub: 'বিলিং, কিচেন ডিসপ্লে, টেবিল, কিউআর অর্ডার, ডেলিভারি, স্টক, রেসিপি খরচ, স্টাফ আর হিসাব — বাংলাদেশের রেস্টুরেন্ট, ক্যাফে, বেকারি ও ক্লাউড কিচেনের জন্য একটি সহজ সফটওয়্যার।',
    cta_primary: 'ফ্রি ট্রায়াল শুরু করুন',
    cta_secondary: 'লগইন',
    hero_note: 'কোনো ইন্সটল লাগে না · মোবাইল, ট্যাব ও পিসিতে চলে · বিকাশ ও নগদ রেডি',
    stats: [
      { value: '১৫+', label: 'মডিউল এক প্যাকেজে' },
      { value: '২৭', label: 'রেডিমেড রিপোর্ট' },
      { value: '৬', label: 'স্টাফ রোল, পিন লগইনসহ' },
      { value: '∞', label: 'ব্রাঞ্চ, স্টাফ ও অর্ডার' }
    ],
    problems_title: 'এই সমস্যাগুলো কি পরিচিত?',
    problems_sub: 'প্রায় সব রেস্টুরেন্ট মালিকই এই সমস্যায় পড়েন। বেবেক্স প্রতিটির সমাধান দেয়।',
    problems: [
      { problem: 'দিন শেষে ক্যাশের হিসাব মেলে না', solution: 'ক্যাশ শিফট নিজেই হিসাব করে ড্রয়ারে কত টাকা থাকার কথা — কম-বেশি সঙ্গে সঙ্গে ধরা পড়ে।' },
      { problem: 'অর্ডার হারিয়ে যায়, খাবার দেরিতে আসে', solution: 'অর্ডার সরাসরি কিচেনের স্ক্রিনে যায়, লাইভ টাইমারসহ। দেরি হলে লাল হয়ে যায়।' },
      { problem: 'স্টক কমে যায়, কেউ জানে না কীভাবে', solution: 'প্রতিটি বিক্রিতে রেসিপি অনুযায়ী উপকরণ কমে। কত লাগার কথা আর কত গেল — টাকার অঙ্কে দেখায়।' },
      { problem: 'কোন খাবারে লাভ, কোনটায় লস — জানা নেই', solution: 'প্রতিটি ডিশের খরচ, লাভ আর ফুড কস্ট % — ক্রয়মূল্য অনুযায়ী নিজে থেকে আপডেট হয়।' },
      { problem: 'স্টাফ ইচ্ছেমতো ডিসকাউন্ট দেয়, বিল বাতিল করে', solution: 'আলাদা লগইন, ডিসকাউন্ট-বাতিল-রিফান্ডে ম্যানেজারের পিন, আর সব কাজের রেকর্ড।' }
    ],
    modules_title: 'এক প্যাকেজে সব ফিচার',
    modules_sub: 'আলাদা কিছু কিনতে হবে না। প্রত্যেক কাস্টমার সব ফিচার পান।',
    modules: [
      { icon: '🧾', title: 'পস ও বিলিং', text: 'ডাইন-ইন, টেকঅ্যাওয়ে, ডেলিভারি ও ড্রাইভ-থ্রুর দ্রুত বিল।', bullets: ['সাইজ, অ্যাড-অন ও রান্নার নির্দেশনা', 'বিল ভাগ, একসাথে করা, টেবিল বদল', 'এক বিলে ক্যাশ + বিকাশ + নগদ + কার্ড', 'লিমিটসহ বাকিতে বিক্রি', 'ইন্টারনেট ছাড়াও চলে, পরে সিঙ্ক হয়'] },
      { icon: '👨‍🍳', title: 'কিচেন ডিসপ্লে', text: 'কাগজবিহীন কিচেন, স্টেশন ও লাইভ টাইমারসহ।', bullets: ['গ্রিল, ড্রিংকস, বেকারি স্টেশন', 'দেরি হলে কমলা, তারপর লাল', 'রেডি হলে ওয়েটারকে নোটিফিকেশন', 'প্রায়োরিটি ও বাতিল অর্ডার'] },
      { icon: '🍽️', title: 'টেবিল ও ফ্লোর প্ল্যান', text: 'প্রতিটি টেবিল, তার বিল আর সময় এক নজরে।', bullets: ['খালি, বসা, রিজার্ভ, পরিষ্কার হচ্ছে', 'ওয়েটার নির্ধারণ', 'যেকোনো সাইজে টেবিলের কিউআর প্রিন্ট'] },
      { icon: '📱', title: 'কিউআর মেনু ও অনলাইন অর্ডার', text: 'কাস্টমার নিজের মোবাইলে অর্ডার করে — অ্যাপ লাগে না।', bullets: ['টেবিল থেকে কিউআর অর্ডার', 'পিকআপ ও হোম ডেলিভারি', '৬টি সুন্দর মেনু থিম', 'লাইভ অর্ডার ট্র্যাকিং'] },
      { icon: '🛵', title: 'ডেলিভারি', text: 'জোন, চার্জ আর রাইডার এক বোর্ডে।', bullets: ['এলাকাভিত্তিক ডেলিভারি চার্জ', 'রাইডার অ্যাসাইন ও স্ট্যাটাস', 'রাইডারের কাছে কত ক্যাশ'] },
      { icon: '📦', title: 'স্টক ও ইনভেন্টরি', text: 'প্রতিটি বিক্রিতে স্টক নিজে থেকে আপডেট।', bullets: ['লো-স্টক অ্যালার্ট', 'নষ্ট, মেয়াদ ও ব্যাচ', 'স্টক গণনা ও ব্রাঞ্চ ট্রান্সফার'] },
      { icon: '🧪', title: 'রেসিপি ও খাবারের খরচ', text: 'প্রতি প্লেটের আসল খরচ আর লাভ জানুন।', bullets: ['প্রতি প্লেটের খরচ ও ফুড কস্ট %', 'সঠিক বিক্রয় মূল্যের পরামর্শ', 'রেসিপির পুরোনো ভার্সন'] },
      { icon: '🚚', title: 'ক্রয় ও সাপ্লায়ার', text: 'সঠিকভাবে কিনুন, মাল নিন, টাকা দিন।', bullets: ['পারচেজ অর্ডার ও মাল গ্রহণ', 'সাপ্লায়ার লেজার ও বাকি', 'উপকরণের দামের ইতিহাস'] },
      { icon: '👥', title: 'কাস্টমার ও লয়্যালটি', text: 'নতুন কাস্টমারকে নিয়মিত কাস্টমারে পরিণত করুন।', bullets: ['অর্ডার হিস্টরি ও প্রিয় খাবার', 'লয়্যালটি পয়েন্ট ও কুপন', 'জন্মদিন রিমাইন্ডার, বাকির লিমিট'] },
      { icon: '🧑‍💼', title: 'স্টাফ ও বেতন', text: 'লগইন, হাজিরা আর বেতন এক জায়গায়।', bullets: ['মালিক, ম্যানেজার, ক্যাশিয়ার, ওয়েটার, শেফ, হিসাবরক্ষক', 'হাজিরা, শিডিউল, ছুটি', 'বেতন, অ্যাডভান্স ও ওভারটাইম'] },
      { icon: '💰', title: 'হিসাব ও ভ্যাট', text: 'আপনার হিসাবের খাতা নিজে থেকেই তৈরি হয়।', bullets: ['লাভ-ক্ষতি, ক্যাশবুক', 'BIN সহ ভ্যাট রিপোর্ট', 'খরচ, বাকি ও মাস শেষের ক্লোজিং'] },
      { icon: '📊', title: 'রিপোর্ট ও মাল্টি-ব্রাঞ্চ', text: 'আসল সংখ্যা দেখে সিদ্ধান্ত নিন।', bullets: ['এক্সেল এক্সপোর্টসহ ২৭টি রিপোর্ট', 'পিক আওয়ার ও বেস্ট সেলার', 'এক অ্যাকাউন্ট থেকে সব ব্রাঞ্চ'] }
    ],
    shots_title: 'দেখুন কীভাবে কাজ করে',
    shots: [
      { img: 'pos', caption: 'পস — কয়েক সেকেন্ডে টেবিলের বিল' },
      { img: 'kitchen', caption: 'লাইভ টাইমারসহ কিচেন ডিসপ্লে' },
      { img: 'tables', caption: 'লাইভ ফ্লোর প্ল্যান' },
      { img: 'recipe', caption: 'প্রতি ডিশের রেসিপি খরচ ও লাভ' },
      { img: 'pnl', caption: 'লাভ-ক্ষতির হিসাব, নিজে থেকেই' },
      { img: 'delivery', caption: 'ডেলিভারি বোর্ড' }
    ],
    steps_title: 'মাত্র ৪ ধাপে শুরু করুন',
    steps: [
      { title: 'অ্যাকাউন্ট খুলুন', text: 'দুই মিনিটে সাইন আপ। নমুনা মেনু ও টেবিল যোগ হয়ে যায়, সঙ্গে সঙ্গে চালিয়ে দেখুন।' },
      { title: 'মেনু যোগ করুন', text: 'ছবি, সাইজ ও অ্যাড-অনসহ আইটেম যোগ করুন — অথবা এক্সেল থেকে পুরো মেনু আপলোড করুন।' },
      { title: 'টেবিল ও স্টাফ সেট করুন', text: 'ফ্লোর ও টেবিল সাজান, কিউআর প্রিন্ট করুন, প্রত্যেক স্টাফকে লগইন বা পিন দিন।' },
      { title: 'বিক্রি শুরু করুন', text: 'অর্ডার নিন, কিচেনে পাঠান, পেমেন্ট নিন। রিপোর্ট নিজে থেকে তৈরি হয়।' }
    ],
    audience_title: 'যাদের জন্য তৈরি',
    audience: ['রেস্টুরেন্ট', 'ক্যাফে', 'ফাস্টফুড', 'বিরিয়ানি হাউস', 'বেকারি ও মিষ্টির দোকান', 'ক্লাউড কিচেন', 'ফুড কোর্ট', 'মাল্টি-ব্রাঞ্চ চেইন'],
    pricing_title: 'সহজ মূল্য',
    pricing_sub: 'এক প্যাকেজে সব ফিচার। মাসিক নিন, অথবা দীর্ঘ মেয়াদে নিয়ে সাশ্রয় করুন।',
    downloads_title: 'ডাউনলোড',
    downloads_sub: 'ইউজার ম্যানুয়াল ও ব্রোশিউর — পড়ুন, আপনার টিমের সাথে শেয়ার করুন।',
    faq_title: 'সাধারণ প্রশ্ন',
    faq: [
      { q: 'কিছু ইন্সটল করতে হবে?', a: 'না। পিসি, ল্যাপটপ, ট্যাব বা মোবাইলের যেকোনো ব্রাউজারে চলে।' },
      { q: 'ইন্টারনেট চলে গেলে কী হবে?', a: 'পস ডিভাইসেই পেমেন্টসহ অর্ডার নিতে থাকে, ইন্টারনেট ফিরলে নিজে থেকে সার্ভারে পাঠিয়ে দেয়।' },
      { q: 'স্টাফদের আলাদা লগইন হবে?', a: 'হ্যাঁ। মালিক, ম্যানেজার, ক্যাশিয়ার, ওয়েটার, শেফ ও হিসাবরক্ষক — প্রত্যেকে শুধু অনুমতি দেওয়া অংশ দেখে। স্টাফরা পিন দিয়ে দ্রুত লগইন করতে পারে।' },
      { q: 'বিকাশ, নগদ আর ভ্যাট সাপোর্ট করে?', a: 'হ্যাঁ। ক্যাশ, কার্ড, বিকাশ, নগদ, রকেট ও বাকি আলাদা হিসাব হয়, আর ভ্যাট ও সার্ভিস চার্জ নিজে থেকে হিসাব হয়।' },
      { q: 'একাধিক ব্রাঞ্চে ব্যবহার করা যাবে?', a: 'হ্যাঁ। যত খুশি ব্রাঞ্চ যোগ করুন, আলাদা বা একসাথে দেখুন।' },
      { q: 'ফ্রি ট্রায়াল শেষে কী হবে?', a: 'মাসিক, ৩ মাস, ৬ মাস বা বাৎসরিক প্যাকেজ বেছে বিকাশ বা নগদে পেমেন্ট করুন। আপনার সব ডেটা আগের মতোই থাকবে।' }
    ],
    contact_title: 'ফ্রি ডেমো নিন',
    contact_text: 'কল করুন বা মেসেজ দিন — আমরা লাইভ সিস্টেম দেখাব এবং আপনার রেস্টুরেন্ট সেটআপে সাহায্য করব।',
    footer_text: '© Baybex. সর্বস্বত্ব সংরক্ষিত।'
  }
};
