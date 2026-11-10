export function validateMassBalance(op, materials) {
  if (!op.massBalance) return;
  const unit = (row) => materials.find((m) => m.id === row.material)?.unit;
  if (
    !op.inputs.some((r) => unit(r) === 'кг') ||
    op.outputs.some((r) => unit(r) !== 'кг') ||
    op.inputs.some(
      (r) => unit(r) !== 'кг' && materials.find((m) => m.id === r.material)?.kind !== 'packaging',
    )
  )
    throw new Error(
      'Материальный баланс требует входы и выходы в кг; упаковка учитывается отдельно',
    );
  const loss = op.parameters.find((p) => p.id === op.lossParameter);
  if (
    !loss ||
    loss.type !== 'number' ||
    loss.unit !== 'кг' ||
    !loss.scaled ||
    !loss.required ||
    loss.min == null ||
    loss.min === '' ||
    Number(loss.min) < 0 ||
    !Number.isFinite(Number(loss.min)) ||
    loss.target == null ||
    loss.target === '' ||
    !Number.isFinite(Number(loss.target))
  )
    throw new Error(
      'Для баланса выберите обязательный числовой параметр потерь в кг с пересчётом на объём и нижним допуском от нуля',
    );
  const input = op.inputs
    .filter((r) => unit(r) === 'кг')
    .reduce((sum, r) => sum + Number(r.qty), 0);
  const output = op.outputs.reduce((sum, r) => sum + Number(r.qty), 0);
  if (Math.abs(input - output - Number(loss.target)) > 0.01)
    throw new Error(
      `Материальный баланс «${op.name}»: вход ${input} кг должен равняться выходу ${output} кг и потерям ${loss.target} кг`,
    );
}

export function operationMassBalance(operation, factor, values, outputs, actualInputs = {}) {
  const round = (n) => Math.round(n * 1000) / 1000;
  const input = round(
    operation.inputs
      .filter((r) => r.unit === 'кг')
      .reduce((sum, r) => sum + (actualInputs[r.id] ?? round(Number(r.qty) * factor)), 0),
  );
  const output = round(
    operation.outputs.reduce(
      (sum, r) => sum + Number(outputs[r.id] ?? round(Number(r.qty) * factor)),
      0,
    ),
  );
  const loss = Number(values[operation.lossParameter] ?? 0);
  return { input, output, loss, difference: round(input - output - loss) };
}
