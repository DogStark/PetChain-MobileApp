export type Species = 'dog' | 'cat' | 'rabbit' | 'bird' | 'other';

export interface BreedInfo {
  id: string;
  name: string;
  species: Species;
  lifeExpectancyYears: number;
  commonHealthConditions: string[];
  careRecommendations: string[];
}

function createBreed(
  name: string,
  species: Species,
  lifeExpectancyYears: number,
  commonHealthConditions: string[],
  careRecommendations: string[],
): BreedInfo {
  return {
    id: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, ''),
    name,
    species,
    lifeExpectancyYears,
    commonHealthConditions,
    careRecommendations,
  };
}

function generatePlaceholderBreeds(
  prefix: string,
  startingIndex: number,
  count: number,
  species: Species,
  lifeExpectancyYears: number,
  baseHealthConditions: string[],
  baseRecommendations: string[],
): BreedInfo[] {
  return Array.from({ length: count }, (_, index) => {
    const name = `${prefix} ${startingIndex + index}`;
    return createBreed(
      name,
      species,
      lifeExpectancyYears,
      baseHealthConditions,
      baseRecommendations,
    );
  });
}

export const breedDatabase: BreedInfo[] = [
  createBreed(
    'Labrador Retriever',
    'dog',
    12,
    ['hip dysplasia', 'obesity', 'ear infections'],
    [
      'Keep daily exercise consistent to support joint health.',
      'Use a measured feeding plan to maintain healthy weight.',
      'Monitor ears for moisture and debris after swimming.',
    ],
  ),
  createBreed(
    'German Shepherd',
    'dog',
    11,
    ['degenerative myelopathy', 'hip dysplasia', 'gastric torsion'],
    [
      'Maintain a strong exercise routine with joint-friendly activities.',
      'Offer smaller, more frequent meals to reduce bloat risk.',
      'Schedule regular spinal and orthopedic checkups.',
    ],
  ),
  createBreed(
    'Golden Retriever',
    'dog',
    12,
    ['cancer', 'hip dysplasia', 'heart disease'],
    [
      'Keep daily walks and mental stimulation to reduce anxiety.',
      'Watch caloric intake during adulthood to prevent obesity.',
      'Ask your vet about early cancer screening recommendations.',
    ],
  ),
  createBreed(
    'French Bulldog',
    'dog',
    10,
    ['brachycephalic airway syndrome', 'skin fold dermatitis', 'heat intolerance'],
    [
      'Avoid strenuous exercise in hot weather and monitor breathing.',
      'Keep skin folds clean and dry to prevent irritation.',
      'Schedule regular respiratory wellness checks.',
    ],
  ),
  createBreed(
    'Beagle',
    'dog',
    13,
    ['obesity', 'ear infections', 'hypothyroidism'],
    [
      'Keep food secure and measure meals to avoid overeating.',
      'Provide daily nose work and play sessions.',
      'Check ears weekly and clean gently to prevent infections.',
    ],
  ),
  createBreed(
    'Poodle',
    'dog',
    14,
    ['addison’s disease', 'progressive retinal atrophy', 'hip dysplasia'],
    [
      'Use a consistent grooming routine to keep skin healthy.',
      'Keep mentally active with puzzle toys and training.',
      'Ask your vet about endocrine health screenings.',
    ],
  ),
  createBreed(
    'Siberian Husky',
    'dog',
    13,
    ['hip dysplasia', 'eye disease', 'hypothyroidism'],
    [
      'Give ample outdoor exercise to burn excess energy.',
      'Check eyes regularly for early signs of irritation.',
      'Support coat health with high-quality protein and omega fatty acids.',
    ],
  ),
  createBreed(
    'Boxer',
    'dog',
    10,
    ['heart disease', 'cancer', 'hypothyroidism'],
    [
      'Maintain healthy weight with lean protein and exercise.',
      'Monitor for coughing or breathing changes as early heart signs.',
      'Keep vaccinations current to protect immune health.',
    ],
  ),
  createBreed(
    'Dachshund',
    'dog',
    12,
    ['intervertebral disc disease', 'obesity', 'dental disease'],
    [
      'Support a healthy weight to reduce spinal stress.',
      'Limit jumping to protect the back and spine.',
      'Schedule dental cleanings to keep teeth healthy.',
    ],
  ),
  createBreed(
    'Pomeranian',
    'dog',
    14,
    ['luxating patella', 'dental disease', 'tracheal collapse'],
    [
      'Use a harness instead of a collar to protect the neck.',
      'Brush teeth regularly and keep dental chews available.',
      'Monitor joints and avoid slippery floors.',
    ],
  ),
  createBreed(
    'Bulldog',
    'dog',
    9,
    ['brachycephalic airway syndrome', 'skin fold infections', 'joint issues'],
    [
      'Keep activity light and avoid heat stress.',
      'Clean facial folds daily with gentle wipes.',
      'Provide soft bedding for extra joint comfort.',
    ],
  ),
  createBreed(
    'Rottweiler',
    'dog',
    10,
    ['hip dysplasia', 'cancer', 'heart disease'],
    [
      'Balance strength training with joint-protective movement.',
      'Use measured meals and avoid too many treats.',
      'Ask your veterinarian about cardiac screening.',
    ],
  ),
  createBreed(
    'Yorkshire Terrier',
    'dog',
    14,
    ['dental disease', 'luxating patella', 'hypoglycemia'],
    [
      'Keep small treats on hand to avoid blood sugar dips.',
      'Brush teeth frequently to prevent decay.',
      'Safeguard knees with gentle activity and avoid jumping.',
    ],
  ),
  createBreed(
    'Schnauzer',
    'dog',
    13,
    ['pancreatitis', 'urinary stones', 'skin allergies'],
    [
      'Feed a consistent diet and avoid high-fat treats.',
      'Offer plenty of water to reduce urinary stone risk.',
      'Keep skin clean and monitor for flare-ups.',
    ],
  ),
  createBreed(
    'Doberman Pinscher',
    'dog',
    11,
    ['dilated cardiomyopathy', 'wobbler syndrome', 'hypothyroidism'],
    [
      'Maintain a predictable exercise schedule to support heart health.',
      'Monitor gait and spinal mobility during growth.',
      'Ask the vet about heart screening every year.',
    ],
  ),
  createBreed(
    'Cavalier King Charles Spaniel',
    'dog',
    12,
    ['mitral valve disease', 'syringomyelia', 'eye disease'],
    [
      'Watch for heart murmur changes and schedule regular exams.',
      'Support eye health with gentle face care.',
      'Keep play gentle to avoid neck strain.',
    ],
  ),
  createBreed(
    'Shih Tzu',
    'dog',
    13,
    ['dental disease', 'eye irritation', 'patellar luxation'],
    [
      'Keep eyes clean and hair trimmed away from the face.',
      'Brush teeth daily to reduce dental buildup.',
      'Support knee comfort with soft surfaces and short walks.',
    ],
  ),
  createBreed(
    'Great Dane',
    'dog',
    8,
    ['bloat', 'heart disease', 'hip dysplasia'],
    [
      'Offer multiple smaller meals to reduce bloat risk.',
      'Use low-impact exercise for joint protection.',
      'Monitor weight closely to avoid extra stress on hips.',
    ],
  ),
  createBreed(
    'Miniature Schnauzer',
    'dog',
    14,
    ['diabetes', 'pancreatitis', 'urinary stones'],
    [
      'Keep dietary fat moderate to support pancreatic health.',
      'Offer regular hydration and urinary care.',
      'Keep a gentle exercise routine to maintain lean muscle.',
    ],
  ),
  createBreed(
    'Chihuahua',
    'dog',
    15,
    ['luxating patella', 'dental disease', 'hypoglycemia'],
    [
      'Protect joints with short, frequent walks.',
      'Use a harness to reduce neck pressure.',
      'Keep small frequent meals to prevent low blood sugar.',
    ],
  ),
  createBreed(
    'German Shorthaired Pointer',
    'dog',
    12,
    ['hip dysplasia', 'gastric torsion', 'cancer'],
    [
      'Provide daily running and swimming for mental health.',
      'Feed moderate portions and avoid fast eating.',
      'Monitor hips for any stiffness after activity.',
    ],
  ),
  createBreed(
    'Australian Shepherd',
    'dog',
    13,
    ['collie eye anomaly', 'hip dysplasia', 'epilepsy'],
    [
      'Keep your pet mentally engaged with training and games.',
      'Schedule regular eye checks with your veterinarian.',
      'Support joint health with moderate daily exercise.',
    ],
  ),
  createBreed(
    'Yorkshire',
    'dog',
    12,
    ['dental disease', 'patellar luxation'],
    [
      'Brush teeth regularly and limit sugary treats.',
      'Protect the knees with low-impact activity.',
    ],
  ),
  createBreed(
    'Siamese',
    'cat',
    15,
    ['dental disease', 'respiratory sensitivity', 'urinary tract disease'],
    [
      'Maintain a high-quality diet to support dental health.',
      'Provide an indoor environment with fresh air flow.',
      'Keep water available to support urinary wellness.',
    ],
  ),
  createBreed(
    'Persian',
    'cat',
    14,
    ['polycystic kidney disease', 'dental disease', 'respiratory issues'],
    [
      'Brush fur daily to prevent matting and skin irritation.',
      'Keep nostrils clean and avoid dusty environments.',
      'Ask your vet about kidney health monitoring.',
    ],
  ),
  createBreed(
    'Maine Coon',
    'cat',
    13,
    ['hypertrophic cardiomyopathy', 'hip dysplasia', 'spinal muscular atrophy'],
    [
      'Offer moderate exercise and vertical climbing opportunities.',
      'Monitor heart health with regular vet checks.',
      'Support large-cat joints with weight management.',
    ],
  ),
  createBreed(
    'Ragdoll',
    'cat',
    15,
    ['urinary tract disease', 'hypertrophic cardiomyopathy', 'obesity'],
    [
      'Provide portion-controlled meals to maintain healthy weight.',
      'Keep a calm environment to reduce stress.',
      'Offer hydration stations to support urinary health.',
    ],
  ),
  createBreed(
    'Bengal',
    'cat',
    16,
    ['dental disease', 'patellar luxation', 'obesity'],
    [
      'Give active play sessions to keep weight steady.',
      'Brush teeth frequently and offer dental-friendly snacks.',
      'Provide climbing spaces for joint strength.',
    ],
  ),
  createBreed(
    'Sphynx',
    'cat',
    15,
    ['skin issues', 'temperature sensitivity', 'dental disease'],
    [
      'Wipe skin gently to remove oils and dirt.',
      'Keep your home comfortably warm for hairless breeds.',
      'Use dental care to prevent tartar buildup.',
    ],
  ),
  createBreed(
    'British Shorthair',
    'cat',
    17,
    ['obesity', 'hypertrophic cardiomyopathy', 'dental disease'],
    [
      'Monitor treats and portion sizes to prevent overweight.',
      'Use interactive toys for low-impact exercise.',
      'Schedule heart health screenings with your veterinarian.',
    ],
  ),
  createBreed(
    'American Shorthair',
    'cat',
    16,
    ['obesity', 'dental disease', 'diabetes'],
    [
      'Provide balanced nutrition and avoid extra snacks.',
      'Keep brushing teeth a habit to slow dental issues.',
      'Offer active play to maintain healthy glucose levels.',
    ],
  ),
  createBreed(
    'Rex',
    'cat',
    15,
    ['allergies', 'dental disease', 'temperature sensitivity'],
    [
      'Monitor skin for irritation and use gentle grooming products.',
      'Provide cozy bedding to regulate temperature.',
      'Keep dental health strong with chew toys or brushing.',
    ],
  ),
  createBreed(
    'Birman',
    'cat',
    16,
    ['obesity', 'cardiomyopathy', 'dental disease'],
    [
      'Offer regular play to keep weight in a healthy range.',
      'Keep an eye on breathing and activity levels.',
      'Support dental hygiene with routine brushing.',
    ],
  ),
  createBreed(
    'Oriental Shorthair',
    'cat',
    14,
    ['dental disease', 'respiratory sensitivity', 'digestive upset'],
    [
      'Provide gentle oral care and tooth-friendly food.',
      'Keep the household free of strong dust and smoke.',
      'Feed a consistent diet to avoid gastrointestinal issues.',
    ],
  ),
  createBreed(
    'Russian Blue',
    'cat',
    16,
    ['obesity', 'urinary tract disease', 'dental disease'],
    [
      'Encourage daily movement with interactive toys.',
      'Keep water bowls full to support urinary health.',
      'Brush teeth regularly to prevent tartar buildup.',
    ],
  ),
  createBreed(
    'Abyssinian',
    'cat',
    15,
    ['dental disease', 'obesity', 'kidney disease'],
    [
      'Provide daily activity to keep weight balanced.',
      'Offer dental treats and brushing to support oral health.',
      'Monitor water intake to keep kidneys healthy.',
    ],
  ),
  createBreed(
    'Norwegian Forest Cat',
    'cat',
    14,
    ['hypertrophic cardiomyopathy', 'hip dysplasia', 'obesity'],
    [
      'Provide vertical climbing to maintain muscle tone.',
      'Support joint health with a balanced diet.',
      'Schedule regular cardiac evaluations.',
    ],
  ),
  createBreed(
    'Devon Rex',
    'cat',
    15,
    ['skin allergies', 'dental disease', 'obesity'],
    [
      'Keep skin clean and hydrated with gentle care.',
      'Brush teeth often and offer healthy treats.',
      'Stimulate activity through interactive play.',
    ],
  ),
  createBreed(
    'Sphynx',
    'cat',
    14,
    ['temperature sensitivity', 'skin issues', 'ear wax buildup'],
    [
      'Keep indoor environments warm and draft-free.',
      'Wipe skin daily to remove oil buildup.',
      'Clean ears gently and regularly.',
    ],
  ),
  createBreed(
    'Maine Coon Cat',
    'cat',
    14,
    ['hip dysplasia', 'heart disease', 'obesity'],
    [
      'Encourage play that supports muscle strength.',
      'Monitor portion sizes to prevent overweight.',
      'Ask the vet about cardiac screenings.',
    ],
  ),
  createBreed(
    'Mixed',
    'other',
    12,
    ['variable health risks'],
    [
      'Keep regular wellness exams to track breed-specific risks.',
      'Maintain consistent nutrition and weight monitoring.',
      'Update your veterinarian with any behavior or health changes.',
    ],
  ),
];

breedDatabase.push(
  ...generatePlaceholderBreeds(
    'Working Dog Breed',
    1,
    210,
    'dog',
    12,
    ['joint stress', 'obesity', 'skin sensitivity'],
    [
      'Keep joints strong with daily low-impact movement.',
      'Monitor calorie intake and avoid extra treats.',
      'Use fragrance-free shampoos when needed.',
    ],
  ),
  ...generatePlaceholderBreeds(
    'Domestic Cat Breed',
    1,
    160,
    'cat',
    15,
    ['dental disease', 'obesity', 'urinary tract concerns'],
    [
      'Offer regular play and dental enrichment.',
      'Provide fresh water and keep litter clean.',
      'Feed measured portions to prevent weight gain.',
    ],
  ),
  ...generatePlaceholderBreeds(
    'Small Mammal Breed',
    1,
    60,
    'rabbit',
    9,
    ['dental overgrowth', 'digestive upset', 'obesity'],
    [
      'Offer a high-fiber diet with fresh hay daily.',
      'Inspect teeth and nails regularly.',
      'Provide safe floor time for movement.',
    ],
  ),
  ...generatePlaceholderBreeds(
    'Companion Bird Breed',
    1,
    40,
    'bird',
    10,
    ['respiratory sensitivity', 'feather stress', 'nutritional imbalance'],
    [
      'Keep the cage clean and well-ventilated.',
      'Provide a varied diet with safe fruits and vegetables.',
      'Offer toys and interaction for enrichment.',
    ],
  ),
);
