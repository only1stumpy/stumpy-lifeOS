export type ExerciseIllustration = "squat" | "hinge" | "lunge" | "push" | "pull" | "core" | "cardio";

export type ExerciseCatalogEntry = {
  id: string;
  name: string;
  category: string;
  muscles: string;
  equipment: string;
  instructions: string;
  illustration: ExerciseIllustration;
};

/** Short, app-authored cues and movement sketches; no external exercise text or media. */
export const exerciseCatalog: ExerciseCatalogEntry[] = [
  { id: "barbell-squat", name: "Приседания со штангой", category: "Ноги и ягодицы", muscles: "Квадрицепсы, ягодицы", equipment: "Штанга, стойка", instructions: "Упри гриф на спину, вдохни и опустись между бёдер. Колени веди по направлению носков, затем встань, сохраняя опору всей стопой.", illustration: "squat" },
  { id: "goblet-squat", name: "Гоблет-присед", category: "Ноги и ягодицы", muscles: "Квадрицепсы, ягодицы", equipment: "Одна гантель или гиря", instructions: "Держи вес у груди. Сядь между бёдер, не отрывая пятки, и поднимись через всю стопу.", illustration: "squat" },
  { id: "leg-press", name: "Жим ногами", category: "Ноги и ягодицы", muscles: "Квадрицепсы, ягодицы", equipment: "Тренажёр для жима ногами", instructions: "Поставь стопы устойчиво на платформу. Опускай её подконтрольно, не округляя поясницу, и выжимай без резкого запирания коленей.", illustration: "squat" },
  { id: "romanian-deadlift", name: "Румынская тяга", category: "Ноги и ягодицы", muscles: "Задняя поверхность бедра, ягодицы", equipment: "Штанга или гантели", instructions: "Слегка согни колени и отведи таз назад. Веди вес близко к ногам, сохраняя спину ровной, затем разогни таз.", illustration: "hinge" },
  { id: "deadlift", name: "Становая тяга", category: "Ноги и ягодицы", muscles: "Ягодицы, задняя поверхность бедра, спина", equipment: "Штанга", instructions: "Подойди к грифу вплотную и возьмись за него. Напряги корпус, оттолкнись стопами от пола и закончи движение, выпрямив таз и колени.", illustration: "hinge" },
  { id: "reverse-lunge", name: "Выпады назад", category: "Ноги и ягодицы", muscles: "Квадрицепсы, ягодицы", equipment: "Собственный вес или гантели", instructions: "Шагни назад и мягко опусти заднее колено. Держи корпус устойчиво и вернись вперёд через опорную стопу.", illustration: "lunge" },
  { id: "hip-thrust", name: "Ягодичный мост со штангой", category: "Ноги и ягодицы", muscles: "Ягодицы", equipment: "Скамья, штанга", instructions: "Обопрись верхом спины о скамью. Подними таз до прямой линии корпуса и бёдер, не переразгибая поясницу.", illustration: "hinge" },
  { id: "bench-press", name: "Жим штанги лёжа", category: "Грудь и плечи", muscles: "Грудные, трицепсы", equipment: "Скамья, штанга", instructions: "Сведи лопатки и поставь стопы на пол. Опусти гриф к середине груди и выжми его вверх по устойчивой траектории.", illustration: "push" },
  { id: "incline-dumbbell-press", name: "Жим гантелей на наклонной скамье", category: "Грудь и плечи", muscles: "Верх груди, передние дельты", equipment: "Наклонная скамья, гантели", instructions: "Устройсь на скамье с опорой стоп. Опусти гантели по сторонам груди, затем выжми вверх без столкновения снарядов.", illustration: "push" },
  { id: "overhead-press", name: "Жим над головой", category: "Грудь и плечи", muscles: "Плечи, трицепсы", equipment: "Штанга или гантели", instructions: "Напряги ягодицы и корпус. Выжми вес над головой, не прогибаясь в пояснице, и опусти к исходному положению.", illustration: "push" },
  { id: "push-up", name: "Отжимания", category: "Грудь и плечи", muscles: "Грудные, плечи, трицепсы", equipment: "Собственный вес", instructions: "Сохраняй тело прямой линией. Опускайсь, сгибая локти назад под комфортным углом, и оттолкнись от пола.", illustration: "push" },
  { id: "lat-pulldown", name: "Тяга верхнего блока", category: "Спина", muscles: "Широчайшие, бицепсы", equipment: "Блочный тренажёр", instructions: "Сядь устойчиво и слегка отклони корпус. Потяни рукоять к верхней части груди, сводя лопатки, затем плавно верни её вверх.", illustration: "pull" },
  { id: "seated-cable-row", name: "Горизонтальная тяга блока", category: "Спина", muscles: "Средняя часть спины, бицепсы", equipment: "Блочный тренажёр", instructions: "Сядь с мягко согнутыми коленями. Потяни рукоять к корпусу, сводя лопатки, и верни руки вперёд без раскачивания.", illustration: "pull" },
  { id: "barbell-row", name: "Тяга штанги в наклоне", category: "Спина", muscles: "Широчайшие, ромбовидные, бицепсы", equipment: "Штанга", instructions: "Отведи таз назад и наклони корпус с ровной спиной. Подтяни гриф к нижним рёбрам и опусти под контролем.", illustration: "pull" },
  { id: "pull-up", name: "Подтягивания", category: "Спина", muscles: "Широчайшие, бицепсы", equipment: "Перекладина", instructions: "Возьмись за перекладину и начни движение лопатками. Поднимись подбородком выше перекладины и плавно опустись.", illustration: "pull" },
  { id: "face-pull", name: "Тяга каната к лицу", category: "Спина", muscles: "Задние дельты, верх спины", equipment: "Блочный тренажёр, канатная рукоять", instructions: "Потяни канат к уровню глаз, разводя концы в стороны. Держи плечи опущенными и вернись вперёд плавно.", illustration: "pull" },
  { id: "lateral-raise", name: "Подъёмы гантелей в стороны", category: "Грудь и плечи", muscles: "Средние дельты", equipment: "Гантели", instructions: "Поднимай гантели в стороны до комфортной высоты, сохраняя лёгкий сгиб локтей. Опускай медленно, не раскачивая корпус.", illustration: "push" },
  { id: "dumbbell-curl", name: "Сгибания рук с гантелями", category: "Руки", muscles: "Бицепсы", equipment: "Гантели", instructions: "Прижми локти к корпусу и подними гантели сгибанием рук. Опусти их плавно, не раскачивая плечи.", illustration: "pull" },
  { id: "cable-triceps-pushdown", name: "Разгибание рук на блоке", category: "Руки", muscles: "Трицепсы", equipment: "Блочный тренажёр", instructions: "Зафиксируй локти у корпуса. Разогни руки вниз и верни рукоять, сохраняя плечи неподвижными.", illustration: "push" },
  { id: "plank", name: "Планка", category: "Корпус", muscles: "Мышцы корпуса", equipment: "Собственный вес", instructions: "Обопрись на предплечья и носки. Удерживай корпус ровным, спокойно дыши и заверши подход до потери положения.", illustration: "core" },
  { id: "cable-crunch", name: "Скручивания на верхнем блоке", category: "Корпус", muscles: "Прямая мышца живота", equipment: "Блочный тренажёр, канатная рукоять", instructions: "Встань на колени перед блоком и зафиксируй таз. Скрути корпус рёбрами к тазу и плавно вернись.", illustration: "core" },
  { id: "treadmill", name: "Беговая дорожка", category: "Кардио", muscles: "Сердечно-сосудистая система, ноги", equipment: "Беговая дорожка", instructions: "Задай комфортные скорость и наклон. Записывай время или дистанцию; увеличивай нагрузку постепенно.", illustration: "cardio" },
  { id: "exercise-bike", name: "Велотренажёр", category: "Кардио", muscles: "Сердечно-сосудистая система, ноги", equipment: "Велотренажёр", instructions: "Отрегулируй сиденье так, чтобы колено оставалось слегка согнутым в нижней точке. Держи ровный темп и отмечай время или дистанцию.", illustration: "cardio" },
  { id: "elliptical", name: "Эллиптический тренажёр", category: "Кардио", muscles: "Сердечно-сосудистая система, ноги", equipment: "Эллиптический тренажёр", instructions: "Встань на педали и задай устойчивый темп. Не переноси вес на поручни; записывай время или дистанцию.", illustration: "cardio" },
  { id: "rowing-machine", name: "Гребной тренажёр", category: "Кардио", muscles: "Ноги, спина, руки", equipment: "Гребной тренажёр", instructions: "Начни толчок ногами, затем подключи корпус и руки. Возвращайсь в обратном порядке: руки, корпус, ноги.", illustration: "cardio" },
];
