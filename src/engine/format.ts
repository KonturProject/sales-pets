/** Число для показа: дробное с запятой («1,5»), целое без «,0». */
export const ruNum = (n: number): string => String(n).replace('.', ',');
