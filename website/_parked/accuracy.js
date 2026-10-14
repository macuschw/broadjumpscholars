// Accuracy: fill the PLACEHOLDER validation table from the mock-data module.
import { VALIDATION_PLACEHOLDER } from "../data/mock-data.js";

document.getElementById("validation-note").textContent = VALIDATION_PLACEHOLDER.note;
document.querySelector("#validation-table tbody").innerHTML = VALIDATION_PLACEHOLDER.rows.map((r) => `
  <tr>
    <th scope="row">${r.metric}</th>
    <td>${r.reference}</td>
    <td class="num-cell">${r.n}</td>
    <td class="num-cell">${r.bias}</td>
    <td class="num-cell">${r.limits}</td>
  </tr>`).join("");
