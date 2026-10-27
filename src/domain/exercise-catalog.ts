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
  { id: "barbell-squat", name: "Приседания со штангой", category: "Ноги и ягодицы", muscles: "Квадрицепсы, ягодицы", equipment: "Штанга, стойка", instructions: "Уприте гриф на спину, вдохните и опуститесь между бёдер. Колени ведите по направлению носков, затем встаньте, сохраняя опору всей стопой.", illustration: "squat" },
  { id: "goblet-squat", name: "Гоблет-присед", category: "Ноги и ягодицы", muscles: "Квадрицепсы, ягодицы", equipment: "Одна гантель или гиря", instructions: "Держите вес у груди. Сядьте между бёдер, не отрывая пятки, и поднимитесь через всю стопу.", illustration: "squat" },
  { id: "leg-press", name: "Жим ногами", category: "Ноги и ягодицы", muscles: "Квадрицепсы, ягодицы", equipment: "Тренажёр для жима ногами", instructions: "Поставьте стопы устойчиво на платформу. Опускайте её подконтрольно, не округляя поясницу, и выжимайте без резкого запирания коленей.", illustration: "squat" },
  { id: "romanian-deadlift", name: "Румынская тяга", category: "Ноги и ягодицы", muscles: "Задняя поверхность бедра, ягодицы", equipment: "Штанга или гантели", instructions: "Слегка согните колени и отведите таз назад. Ведите вес близко к ногам, сохраняя спину ровной, затем разогните таз.", illustration: "hinge" },
  { id: "deadlift", name: "Становая тяга", category: "Ноги и ягодицы", muscles: "Ягодицы, задняя поверхность бедра, спина", equipment: "Штанга", instructions: "Подойдите к грифу вплотную и возьмитесь за него. Напрягите корпус, оттолкнитесь стопами от пола и закончите движение, выпрямив таз и колени.", illustration: "hinge" },
  { id: "reverse-lunge", name: "Выпады назад", category: "Ноги и ягодицы", muscles: "Квадрицепсы, ягодицы", equipment: "Собственный вес или гантели", instructions: "Шагните назад и мягко опустите заднее колено. Держите корпус устойчиво и вернитесь вперёд через опорную стопу.", illustration: "lunge" },
  { id: "hip-thrust", name: "Ягодичный мост со штангой", category: "Ноги и ягодицы", muscles: "Ягодицы", equipment: "Скамья, штанга", instructions: "Обопритесь верхом спины о скамью. Поднимите таз до прямой линии корпуса и бёдер, не переразгибая поясницу.", illustration: "hinge" },
  { id: "bench-press", name: "Жим штанги лёжа", category: "Грудь и плечи", muscles: "Грудные, трицепсы", equipment: "Скамья, штанга", instructions: "Сведите лопатки и поставьте стопы на пол. Опустите гриф к середине груди и выжмите его вверх по устойчивой траектории.", illustration: "push" },
  { id: "incline-dumbbell-press", name: "Жим гантелей на наклонной скамье", category: "Грудь и плечи", muscles: "Верх груди, передние дельты", equipment: "Наклонная скамья, гантели", instructions: "Устройтесь на скамье с опорой стоп. Опустите гантели по сторонам груди, затем выжмите вверх без столкновения снарядов.", illustration: "push" },
  { id: "overhead-press", name: "Жим над головой", category: "Грудь и плечи", muscles: "Плечи, трицепсы", equipment: "Штанга или гантели", instructions: "Напрягите ягодицы и корпус. Выжмите вес над головой, не прогибаясь в пояснице, и опустите к исходному положению.", illustration: "push" },
  { id: "push-up", name: "Отжимания", category: "Грудь и плечи", muscles: "Грудные, плечи, трицепсы", equipment: "Собственный вес", instructions: "Сохраняйте тело прямой линией. Опускайтесь, сгибая локти назад под комфортным углом, и оттолкнитесь от пола.", illustration: "push" },
  { id: "lat-pulldown", name: "Тяга верхнего блока", category: "Спина", muscles: "Широчайшие, бицепсы", equipment: "Блочный тренажёр", instructions: "Сядьте устойчиво и слегка отклоните корпус. Потяните рукоять к верхней части груди, сводя лопатки, затем плавно верните её вверх.", illustration: "pull" },
  { id: "seated-cable-row", name: "Горизонтальная тяга блока", category: "Спина", muscles: "Средняя часть спины, бицепсы", equipment: "Блочный тренажёр", instructions: "Сядьте с мягко согнутыми коленями. Потяните рукоять к корпусу, сводя лопатки, и верните руки вперёд без раскачивания.", illustration: "pull" },
  { id: "barbell-row", name: "Тяга штанги в наклоне", category: "Спина", muscles: "Широчайшие, ромбовидные, бицепсы", equipment: "Штанга", instructions: "Отведите таз назад и наклоните корпус с ровной спиной. Подтяните гриф к нижним рёбрам и опустите под контролем.", illustration: "pull" },
  { id: "pull-up", name: "Подтягивания", category: "Спина", muscles: "Широчайшие, бицепсы", equipment: "Перекладина", instructions: "Возьмитесь за перекладину и начните движение лопатками. Поднимитесь подбородком выше перекладины и плавно опуститесь.", illustration: "pull" },
  { id: "face-pull", name: "Тяга каната к лицу", category: "Спина", muscles: "Задние дельты, верх спины", equipment: "Блочный тренажёр, канатная рукоять", instructions: "Потяните канат к уровню глаз, разводя концы в стороны. Держите плечи опущенными и вернитесь вперёд плавно.", illustration: "pull" },
  { id: "lateral-raise", name: "Подъёмы гантелей в стороны", category: "Грудь и плечи", muscles: "Средние дельты", equipment: "Гантели", instructions: "Поднимайте гантели в стороны до комфортной высоты, сохраняя лёгкий сгиб локтей. Опускайте медленно, не раскачивая корпус.", illustration: "push" },
  { id: "dumbbell-curl", name: "Сгибания рук с гантелями", category: "Руки", muscles: "Бицепсы", equipment: "Гантели", instructions: "Прижмите локти к корпусу и поднимите гантели сгибанием рук. Опустите их плавно, не раскачивая плечи.", illustration: "pull" },
  { id: "cable-triceps-pushdown", name: "Разгибание рук на блоке", category: "Руки", muscles: "Трицепсы", equipment: "Блочный тренажёр", instructions: "Зафиксируйте локти у корпуса. Разогните руки вниз и верните рукоять, сохраняя плечи неподвижными.", illustration: "push" },
  { id: "plank", name: "Планка", category: "Корпус", muscles: "Мышцы корпуса", equipment: "Собственный вес", instructions: "Обопритесь на предплечья и носки. Удерживайте корпус ровным, спокойно дышите и завершите подход до потери положения.", illustration: "core" },
  { id: "cable-crunch", name: "Скручивания на верхнем блоке", category: "Корпус", muscles: "Прямая мышца живота", equipment: "Блочный тренажёр, канатная рукоять", instructions: "Встаньте на колени перед блоком и зафиксируйте таз. Скрутите корпус рёбрами к тазу и плавно вернитесь.", illustration: "core" },
  { id: "treadmill", name: "Беговая дорожка", category: "Кардио", muscles: "Сердечно-сосудистая система, ноги", equipment: "Беговая дорожка", instructions: "Задайте комфортные скорость и наклон. Записывайте время или дистанцию; увеличивайте нагрузку постепенно.", illustration: "cardio" },
  { id: "exercise-bike", name: "Велотренажёр", category: "Кардио", muscles: "Сердечно-сосудистая система, ноги", equipment: "Велотренажёр", instructions: "Отрегулируйте сиденье так, чтобы колено оставалось слегка согнутым в нижней точке. Держите ровный темп и отмечайте время или дистанцию.", illustration: "cardio" },
  { id: "elliptical", name: "Эллиптический тренажёр", category: "Кардио", muscles: "Сердечно-сосудистая система, ноги", equipment: "Эллиптический тренажёр", instructions: "Встаньте на педали и задайте устойчивый темп. Не переносите вес на поручни; записывайте время или дистанцию.", illustration: "cardio" },
  { id: "rowing-machine", name: "Гребной тренажёр", category: "Кардио", muscles: "Ноги, спина, руки", equipment: "Гребной тренажёр", instructions: "Начните толчок ногами, затем подключите корпус и руки. Возвращайтесь в обратном порядке: руки, корпус, ноги.", illustration: "cardio" },
];
