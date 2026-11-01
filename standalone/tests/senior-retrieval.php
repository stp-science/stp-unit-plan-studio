<?php
declare(strict_types=1);
require dirname(__DIR__) . '/public/curriculum_studio_lib.php';
$documents = cs_senior_docs();
if (count($documents) !== 51) throw new RuntimeException('Check the senior curriculum catalogue.');
foreach ($documents as $document) if (empty(cs_catalogue_content($document)['pages'])) throw new RuntimeException('Missing senior source text.');
$links = cs_senior_future('Science', 'Cells', 'microscope organelles cells tissues organs organisms multicellular single-celled bacteria fungi algae');
$names = array_column($links, 'document');
if (!in_array('Biology — Years 12–13', $names, true) || !in_array('Science — Year 11', $names, true)) throw new RuntimeException('Cells must connect to biological senior learning.');
foreach ($links as $link) {
    if (str_contains($link['document'], 'Earth and Space')) throw new RuntimeException('Atmospheric cells were incorrectly matched.');
    if (str_contains($link['excerpt'], 'Purpose statement')) throw new RuntimeException('Introduction replaced the teaching content.');
    if (mb_strlen($link['excerpt']) > 4500) throw new RuntimeException('Senior evidence budget exceeded.');
}
$doc = cs_catalogue_doc('senior-biology-years12-13-oct26-1');
$body = cs_catalogue_content($doc);
$pages = cs_senior_pages($body['pages'], 'Cells', 45000);
if (!$pages) throw new RuntimeException('No senior statement evidence.');
foreach ($pages as $page) {
    $original = array_values(array_filter($body['pages'], static fn($p) => $p['page'] === $page['page']));
    if (!$original || $page['text'] !== $original[0]['text']) throw new RuntimeException('Statement extraction must use intact pages.');
}
echo "Verified 51 senior curriculum sources; Cells retrieves Biology and Year 11 Science teaching content; full statement pages preserved. No AI calls.\n";
